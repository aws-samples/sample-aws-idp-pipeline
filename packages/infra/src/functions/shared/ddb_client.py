import os
import secrets
import string
from datetime import datetime, timezone
from typing import Optional
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

ddb_resource = None

BACKEND_TABLE_NAME = os.environ.get('BACKEND_TABLE_NAME', '')
NANOID_ALPHABET = string.ascii_letters + string.digits + '_-'
NANOID_SIZE = 21


def get_ddb_resource():
    global ddb_resource
    if ddb_resource is None:
        ddb_resource = boto3.resource(
            'dynamodb',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return ddb_resource


def get_table():
    return get_ddb_resource().Table(BACKEND_TABLE_NAME)


def generate_nanoid(size: int = NANOID_SIZE) -> str:
    return ''.join(secrets.choice(NANOID_ALPHABET) for _ in range(size))


def generate_workflow_id() -> str:
    return f'wf_{generate_nanoid()}'


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def decimal_to_python(obj):
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_python(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_python(i) for i in obj]
    return obj


class EntityType:
    DOCUMENT = 'DOC'
    WEB = 'WEB'


def get_entity_prefix(file_type: str) -> str:
    """Determine entity prefix based on file type."""
    if file_type == 'application/x-webreq':
        return EntityType.WEB
    return EntityType.DOCUMENT


class WorkflowStatus:
    PENDING = 'pending'
    IN_PROGRESS = 'in_progress'
    COMPLETED = 'completed'
    FAILED = 'failed'
    SKIPPED = 'skipped'


class PreprocessStatus:
    PENDING = 'pending'
    PROCESSING = 'processing'
    COMPLETED = 'completed'
    FAILED = 'failed'
    SKIPPED = 'skipped'


class PreprocessType:
    OCR = 'ocr'
    BDA = 'bda'
    TRANSCRIBE = 'transcribe'
    WEBCRAWLER = 'webcrawler'

    ALL = ['ocr', 'bda', 'transcribe', 'webcrawler']


def determine_preprocess_required(file_type: str, use_bda: bool = False) -> dict:
    """Determine which preprocessors are required based on file type and options.

    Note: Parser is handled in Step Functions workflow, not as async preprocessing.
    """
    is_pdf = file_type == 'application/pdf'
    is_image = file_type.startswith('image/')
    is_video = file_type.startswith('video/')
    is_audio = file_type.startswith('audio/')
    is_webreq = file_type == 'application/x-webreq'

    return {
        PreprocessType.OCR: {
            'required': (is_pdf or is_image) and not is_webreq,
            'status': PreprocessStatus.PENDING if ((is_pdf or is_image) and not is_webreq) else PreprocessStatus.SKIPPED
        },
        PreprocessType.BDA: {
            'required': use_bda and not is_webreq,
            'status': PreprocessStatus.PENDING if (use_bda and not is_webreq) else PreprocessStatus.SKIPPED
        },
        PreprocessType.TRANSCRIBE: {
            'required': (is_video or is_audio) and not is_webreq,
            'status': PreprocessStatus.PENDING if ((is_video or is_audio) and not is_webreq) else PreprocessStatus.SKIPPED
        },
        PreprocessType.WEBCRAWLER: {
            'required': is_webreq,
            'status': PreprocessStatus.PENDING if is_webreq else PreprocessStatus.SKIPPED
        }
    }


class StepName:
    SEGMENT_PREP = 'segment_prep'
    BDA_PROCESSOR = 'bda_processor'
    FORMAT_PARSER = 'format_parser'
    PADDLEOCR_PROCESSOR = 'paddleocr_processor'
    TRANSCRIBE = 'transcribe'
    WEBCRAWLER = 'webcrawler'
    SEGMENT_BUILDER = 'segment_builder'
    SEGMENT_ANALYZER = 'segment_analyzer'
    DOCUMENT_SUMMARIZER = 'document_summarizer'

    ORDER = [
        'segment_prep',
        'bda_processor',
        'format_parser',
        'paddleocr_processor',
        'transcribe',
        'webcrawler',
        'segment_builder',
        'segment_analyzer',
        'document_summarizer'
    ]

    LABELS = {
        'segment_prep': 'Segment Prep',
        'bda_processor': 'BDA Processing',
        'format_parser': 'Format Parsing',
        'paddleocr_processor': 'PaddleOCR Processing',
        'transcribe': 'Transcription',
        'webcrawler': 'Web Crawling',
        'segment_builder': 'Building Segments',
        'segment_analyzer': 'Segment Analysis',
        'document_summarizer': 'Document Summary'
    }


def create_workflow(
    workflow_id: str,
    document_id: str,
    project_id: str,
    file_uri: str,
    file_name: str,
    file_type: str,
    execution_arn: str,
    language: str = 'en',
    use_bda: bool = False
) -> dict:
    table = get_table()
    now = now_iso()

    # Determine entity prefix based on file type (WEB# for webreq, DOC# for others)
    entity_prefix = get_entity_prefix(file_type)

    # Determine required preprocessors based on file type and options
    preprocess = determine_preprocess_required(file_type, use_bda)

    # Main workflow item under document/web entity
    workflow_item = {
        'PK': f'{entity_prefix}#{document_id}',
        'SK': f'WF#{workflow_id}',
        'data': {
            'project_id': project_id,
            'file_uri': file_uri,
            'file_name': file_name,
            'file_type': file_type,
            'execution_arn': execution_arn,
            'status': WorkflowStatus.PENDING,
            'language': language,
            'total_segments': 0,
            'preprocess': preprocess
        },
        'created_at': now,
        'updated_at': now
    }

    # Determine which steps should be skipped based on file type and options
    is_pdf = file_type == 'application/pdf'
    is_image = file_type.startswith('image/')
    is_video = file_type.startswith('video/')
    is_audio = file_type.startswith('audio/')
    is_webreq = file_type == 'application/x-webreq'

    skip_conditions = {
        StepName.BDA_PROCESSOR: not use_bda or is_webreq,
        StepName.PADDLEOCR_PROCESSOR: not (is_pdf or is_image) or is_webreq,
        StepName.TRANSCRIBE: not (is_video or is_audio) or is_webreq,
        StepName.FORMAT_PARSER: not is_pdf or is_webreq,
        StepName.WEBCRAWLER: not is_webreq,
        StepName.SEGMENT_ANALYZER: is_webreq,
    }

    # Initialize STEP row with appropriate statuses
    steps_data = {
        'project_id': project_id,
        'document_id': document_id,
        'current_step': ''
    }
    for step_name in StepName.ORDER:
        should_skip = skip_conditions.get(step_name, False)
        steps_data[step_name] = {
            'status': WorkflowStatus.SKIPPED if should_skip else WorkflowStatus.PENDING,
            'label': StepName.LABELS.get(step_name, step_name)
        }

    steps_item = {
        'PK': f'WF#{workflow_id}',
        'SK': 'STEP',
        'GSI1PK': 'STEP#ANALYSIS_STATUS',
        'GSI1SK': 'pending',
        'data': steps_data,
        'created_at': now,
        'updated_at': now
    }

    with table.batch_writer() as batch:
        batch.put_item(Item=workflow_item)
        batch.put_item(Item=steps_item)

    return workflow_item


def update_workflow_status(document_id: str, workflow_id: str, status: str, entity_type: str = EntityType.DOCUMENT, **kwargs) -> dict:
    table = get_table()
    now = now_iso()

    workflow = get_workflow(document_id, workflow_id, entity_type)
    if not workflow:
        return {}

    data = workflow.get('data', {})
    data['status'] = status
    for key, value in kwargs.items():
        data[key] = value

    is_terminal = status in [WorkflowStatus.COMPLETED, WorkflowStatus.FAILED]

    update_expr = 'SET #data = :data, updated_at = :updated_at'
    expr_values = {':data': data, ':updated_at': now}

    table.update_item(
        Key={'PK': f'{entity_type}#{document_id}', 'SK': f'WF#{workflow_id}'},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues=expr_values
    )

    # Also update document status to match workflow status
    # Document record is always at PROJ#/DOC# regardless of entity type
    project_id = data.get('project_id')
    if project_id:
        update_document_status(project_id, document_id, status)

    return decimal_to_python({'data': data, 'updated_at': now})


def update_document_status(project_id: str, document_id: str, status: str) -> bool:
    """Update document status in DynamoDB."""
    table = get_table()
    now = now_iso()

    try:
        table.update_item(
            Key={'PK': f'PROJ#{project_id}', 'SK': f'DOC#{document_id}'},
            UpdateExpression='SET #data.#status = :status, updated_at = :updated_at',
            ExpressionAttributeNames={'#data': 'data', '#status': 'status'},
            ExpressionAttributeValues={':status': status, ':updated_at': now}
        )
        return True
    except Exception as e:
        print(f'Failed to update document status: {e}')
        return False


def get_workflow(document_id: str, workflow_id: str, entity_type: str = EntityType.DOCUMENT) -> Optional[dict]:
    table = get_table()
    response = table.get_item(
        Key={'PK': f'{entity_type}#{document_id}', 'SK': f'WF#{workflow_id}'}
    )
    item = response.get('Item')
    return decimal_to_python(item) if item else None


def update_preprocess_status(
    document_id: str,
    workflow_id: str,
    processor: str,
    status: str,
    entity_type: str = EntityType.DOCUMENT,
    **kwargs
) -> dict:
    """Update preprocess status for a specific processor.

    Args:
        document_id: Document ID
        workflow_id: Workflow ID
        processor: One of 'ocr', 'parser', 'bda', 'transcribe', 'webcrawler'
        status: One of 'pending', 'processing', 'completed', 'failed', 'skipped'
        entity_type: 'DOC' for documents, 'WEB' for web crawled content
        **kwargs: Additional fields to update (e.g., error, output_uri)
    """
    table = get_table()
    now = now_iso()

    workflow = get_workflow(document_id, workflow_id, entity_type)
    if not workflow:
        return {}

    data = workflow.get('data', {})
    preprocess = data.get('preprocess', {})
    processor_data = preprocess.get(processor, {})

    processor_data['status'] = status
    if status == PreprocessStatus.PROCESSING:
        processor_data['started_at'] = now
    elif status in [PreprocessStatus.COMPLETED, PreprocessStatus.FAILED]:
        processor_data['ended_at'] = now

    for key, value in kwargs.items():
        processor_data[key] = value

    preprocess[processor] = processor_data
    data['preprocess'] = preprocess

    response = table.update_item(
        Key={'PK': f'{entity_type}#{document_id}', 'SK': f'WF#{workflow_id}'},
        UpdateExpression='SET #data = :data, updated_at = :updated_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':updated_at': now},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def is_preprocess_complete(document_id: str, workflow_id: str, entity_type: str = EntityType.DOCUMENT) -> dict:
    """Check if all required preprocessing is complete.

    Returns:
        dict with keys:
        - all_completed: True if all required preprocessors are completed/skipped
        - any_failed: True if any required preprocessor has failed
        - status: dict of each preprocessor's status
    """
    workflow = get_workflow(document_id, workflow_id, entity_type)
    if not workflow:
        return {'all_completed': False, 'any_failed': False, 'status': {}}

    data = workflow.get('data', {})
    preprocess = data.get('preprocess', {})

    all_completed = True
    any_failed = False
    status = {}

    for processor in PreprocessType.ALL:
        proc_data = preprocess.get(processor, {})
        proc_status = proc_data.get('status', PreprocessStatus.SKIPPED)
        is_required = proc_data.get('required', False)

        status[processor] = {
            'required': is_required,
            'status': proc_status
        }

        if is_required:
            if proc_status == PreprocessStatus.FAILED:
                any_failed = True
            if proc_status not in [PreprocessStatus.COMPLETED, PreprocessStatus.SKIPPED]:
                all_completed = False

    return {
        'all_completed': all_completed,
        'any_failed': any_failed,
        'status': status
    }


def is_analysis_busy(workflow_id: str) -> bool:
    """Check if another workflow's segment analysis is currently in progress.

    Uses GSI1 to query STEP records with GSI1PK='STEP#ANALYSIS_STATUS'
    and GSI1SK='in_progress'. Returns True if any other workflow is running analysis.
    """
    table = get_table()
    response = table.query(
        IndexName='GSI1',
        KeyConditionExpression=Key('GSI1PK').eq('STEP#ANALYSIS_STATUS') & Key('GSI1SK').eq('in_progress')
    )
    items = response.get('Items', [])
    return any(item['PK'] != f'WF#{workflow_id}' for item in items)


def get_steps(workflow_id: str) -> Optional[dict]:
    """Get workflow steps progress (SK: STEP)"""
    table = get_table()
    response = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'}
    )
    item = response.get('Item')
    return decimal_to_python(item) if item else None


def update_workflow_total_segments(document_id: str, workflow_id: str, total_segments: int, entity_type: str = EntityType.DOCUMENT) -> dict:
    """Update workflow total_segments count"""
    table = get_table()
    now = now_iso()

    response = table.update_item(
        Key={'PK': f'{entity_type}#{document_id}', 'SK': f'WF#{workflow_id}'},
        UpdateExpression='SET #data.#ts = :ts, updated_at = :updated_at',
        ExpressionAttributeNames={'#data': 'data', '#ts': 'total_segments'},
        ExpressionAttributeValues={':ts': total_segments, ':updated_at': now},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def record_step_start(workflow_id: str, step_name: str, **kwargs) -> dict:
    """Update step status to in_progress in STEP row"""
    table = get_table()
    now = now_iso()

    steps = get_steps(workflow_id)
    if not steps:
        return {}

    data = steps.get('data', {})
    step_data = data.get(step_name, {})
    step_data['status'] = WorkflowStatus.IN_PROGRESS
    step_data['started_at'] = now
    for key, value in kwargs.items():
        step_data[key] = value
    data[step_name] = step_data
    data['current_step'] = step_name

    update_expr = 'SET #data = :data'
    expr_names = {'#data': 'data'}
    expr_values = {':data': data}

    if step_name == StepName.SEGMENT_ANALYZER:
        update_expr += ', GSI1SK = :gsi1sk'
        expr_values[':gsi1sk'] = 'in_progress'

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def record_step_complete(workflow_id: str, step_name: str, **kwargs) -> dict:
    """Update step status to completed in STEP row"""
    table = get_table()
    now = now_iso()

    steps = get_steps(workflow_id)
    if not steps:
        return {}

    data = steps.get('data', {})
    step_data = data.get(step_name, {})
    step_data['status'] = WorkflowStatus.COMPLETED
    step_data['ended_at'] = now
    for key, value in kwargs.items():
        step_data[key] = value
    data[step_name] = step_data

    # Find current in_progress step
    current_step = ''
    for sn in StepName.ORDER:
        if data.get(sn, {}).get('status') == WorkflowStatus.IN_PROGRESS:
            current_step = sn
            break
    data['current_step'] = current_step

    update_expr = 'SET #data = :data, updated_at = :updated_at'
    expr_names = {'#data': 'data'}
    expr_values = {':data': data, ':updated_at': now}

    if step_name == StepName.SEGMENT_ANALYZER:
        update_expr += ', GSI1SK = :gsi1sk'
        expr_values[':gsi1sk'] = 'completed'

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def record_step_error(workflow_id: str, step_name: str, error: str) -> dict:
    """Update step status to failed in STEP row"""
    table = get_table()
    now = now_iso()

    steps = get_steps(workflow_id)
    if not steps:
        return {}

    data = steps.get('data', {})
    step_data = data.get(step_name, {})
    step_data['status'] = WorkflowStatus.FAILED
    step_data['error'] = error
    data[step_name] = step_data
    data['current_step'] = ''

    update_expr = 'SET #data = :data, updated_at = :updated_at'
    expr_names = {'#data': 'data'}
    expr_values = {':data': data, ':updated_at': now}

    if step_name == StepName.SEGMENT_ANALYZER:
        update_expr += ', GSI1SK = :gsi1sk'
        expr_values[':gsi1sk'] = 'failed'

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def record_step_skipped(workflow_id: str, step_name: str, reason: str = '') -> dict:
    """Update step status to skipped in STEP row"""
    table = get_table()
    now = now_iso()

    steps = get_steps(workflow_id)
    if not steps:
        return {}

    data = steps.get('data', {})
    step_data = data.get(step_name, {})
    step_data['status'] = WorkflowStatus.SKIPPED
    if reason:
        step_data['reason'] = reason
    data[step_name] = step_data

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'},
        UpdateExpression='SET #data = :data, updated_at = :updated_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':updated_at': now},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def save_segment(
    workflow_id: str,
    segment_index: int,
    s3_key: str = '',
    image_uri: str = ''
) -> dict:
    """Save segment reference to DynamoDB. Actual data is stored in S3."""
    table = get_table()
    segment_key = f'{segment_index:04d}'
    now = now_iso()

    item = {
        'PK': f'WF#{workflow_id}',
        'SK': f'SEG#{segment_key}',
        'data': {
            'segment_index': segment_index,
            's3_key': s3_key,
            'image_uri': image_uri
        },
        'created_at': now,
        'updated_at': now
    }

    table.put_item(Item=item)
    return item


def update_segment(workflow_id: str, segment_index: int, **kwargs) -> dict:
    table = get_table()
    segment_key = f'{segment_index:04d}'
    now = now_iso()

    existing = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'SEG#{segment_key}'}
    ).get('Item', {})

    data = existing.get('data', {})
    for key, value in kwargs.items():
        data[key] = value

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'SEG#{segment_key}'},
        UpdateExpression='SET #data = :data, updated_at = :updated_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':updated_at': now},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def get_segment(workflow_id: str, segment_index: int) -> Optional[dict]:
    table = get_table()
    segment_key = f'{segment_index:04d}'
    response = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'SEG#{segment_key}'}
    )
    item = response.get('Item')
    if item:
        result = decimal_to_python(item)
        data = result.get('data', {})
        return {**result, **data}
    return None


def get_all_segments(workflow_id: str) -> list:
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'WF#{workflow_id}') & Key('SK').begins_with('SEG#')
    )
    items = decimal_to_python(response.get('Items', []))
    return [{**item, **item.get('data', {})} for item in items]


def get_segment_count(workflow_id: str) -> int:
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'WF#{workflow_id}') & Key('SK').begins_with('SEG#'),
        Select='COUNT'
    )
    return response.get('Count', 0)


def add_image_analysis(
    workflow_id: str,
    segment_index: int,
    analysis_query: str,
    content: str
) -> dict:
    """Add image analysis result to segment's image_analysis array"""
    table = get_table()
    segment_key = f'{segment_index:04d}'
    now = now_iso()

    segment = get_segment(workflow_id, segment_index)
    if not segment:
        return {}

    data = segment.get('data', {})
    image_analysis = data.get('image_analysis', [])
    image_analysis.append({
        'analysis_query': analysis_query,
        'content': content
    })
    data['image_analysis'] = image_analysis

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'SEG#{segment_key}'},
        UpdateExpression='SET #data = :data, updated_at = :updated_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':updated_at': now},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def batch_save_segments(workflow_id: str, segments: list) -> int:
    """Batch save segment references to DynamoDB. Actual data is stored in S3."""
    table = get_table()
    now = now_iso()
    count = 0

    with table.batch_writer() as batch:
        for seg in segments:
            segment_index = seg.get('segment_index', 0)
            segment_key = f'{segment_index:04d}'

            item = {
                'PK': f'WF#{workflow_id}',
                'SK': f'SEG#{segment_key}',
                'data': {
                    'segment_index': segment_index,
                    's3_key': seg.get('s3_key', ''),
                    'image_uri': seg.get('image_uri', '')
                },
                'created_at': now,
                'updated_at': now
            }
            batch.put_item(Item=item)
            count += 1

    return count


def delete_workflow_all_items(workflow_id: str) -> int:
    """Delete all items related to a workflow (META, STEP, SEG#*, ANALYSIS#*, CONN#*)"""
    table = get_table()
    deleted_count = 0

    # Query all items with PK = WF#{workflow_id}
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'WF#{workflow_id}')
    )
    items = response.get('Items', [])

    # Handle pagination
    while response.get('LastEvaluatedKey'):
        response = table.query(
            KeyConditionExpression=Key('PK').eq(f'WF#{workflow_id}'),
            ExclusiveStartKey=response['LastEvaluatedKey']
        )
        items.extend(response.get('Items', []))

    # Batch delete all items
    with table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={'PK': item['PK'], 'SK': item['SK']})
            deleted_count += 1

    return deleted_count


def get_workflows_by_project(project_id: str) -> list:
    """Get all workflow IDs for a project"""
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'PROJ#{project_id}') & Key('SK').begins_with('WF#')
    )
    items = response.get('Items', [])

    # Handle pagination
    while response.get('LastEvaluatedKey'):
        response = table.query(
            KeyConditionExpression=Key('PK').eq(f'PROJ#{project_id}') & Key('SK').begins_with('WF#'),
            ExclusiveStartKey=response['LastEvaluatedKey']
        )
        items.extend(response.get('Items', []))

    return [item['SK'].replace('WF#', '') for item in items]


def get_documents_by_project(project_id: str) -> list:
    """Get all document IDs for a project"""
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'PROJ#{project_id}') & Key('SK').begins_with('DOC#')
    )
    items = response.get('Items', [])

    # Handle pagination
    while response.get('LastEvaluatedKey'):
        response = table.query(
            KeyConditionExpression=Key('PK').eq(f'PROJ#{project_id}') & Key('SK').begins_with('DOC#'),
            ExclusiveStartKey=response['LastEvaluatedKey']
        )
        items.extend(response.get('Items', []))

    return [{'document_id': item['SK'].replace('DOC#', ''), 'data': item.get('data', {})} for item in items]


def delete_document_items(project_id: str, document_id: str) -> int:
    """Delete document item from project"""
    table = get_table()
    table.delete_item(Key={'PK': f'PROJ#{project_id}', 'SK': f'DOC#{document_id}'})
    return 1


def delete_project_workflow_link(project_id: str, workflow_id: str) -> None:
    """Delete project-workflow link"""
    table = get_table()
    table.delete_item(Key={'PK': f'PROJ#{project_id}', 'SK': f'WF#{workflow_id}'})


def delete_project_item(project_id: str) -> None:
    """Delete project item"""
    table = get_table()
    table.delete_item(Key={'PK': f'PROJ#{project_id}', 'SK': f'PROJ#{project_id}'})


def delete_project_all_items(project_id: str) -> int:
    """Delete all items related to a project (PROJ#, DOC#*, WF#* links)"""
    table = get_table()
    deleted_count = 0

    # Query all items with PK = PROJ#{project_id}
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'PROJ#{project_id}')
    )
    items = response.get('Items', [])

    # Handle pagination
    while response.get('LastEvaluatedKey'):
        response = table.query(
            KeyConditionExpression=Key('PK').eq(f'PROJ#{project_id}'),
            ExclusiveStartKey=response['LastEvaluatedKey']
        )
        items.extend(response.get('Items', []))

    # Batch delete all items
    with table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={'PK': item['PK'], 'SK': item['SK']})
            deleted_count += 1

    return deleted_count


def get_workflow_by_document(project_id: str, document_name: str) -> Optional[str]:
    """Find workflow_id by document name"""
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'PROJ#{project_id}') & Key('SK').begins_with('WF#')
    )

    for item in response.get('Items', []):
        data = item.get('data', {})
        if data.get('file_name') == document_name:
            return item['SK'].replace('WF#', '')

    return None


def get_project_language(project_id: str) -> str:
    """Get project language setting. Returns 'en' if not set."""
    table = get_table()
    response = table.get_item(
        Key={'PK': f'PROJ#{project_id}', 'SK': 'META'}
    )
    item = response.get('Item')
    if item:
        data = item.get('data', {})
        return data.get('language') or 'en'
    return 'en'


def get_project_document_prompt(project_id: str) -> str:
    """Get project document analysis prompt. Returns empty string if not set."""
    table = get_table()
    response = table.get_item(
        Key={'PK': f'PROJ#{project_id}', 'SK': 'META'}
    )
    item = response.get('Item')
    if item:
        data = item.get('data', {})
        return data.get('document_prompt') or ''
    return ''


def get_project_ocr_settings(project_id: str) -> dict:
    """Get project OCR settings. Returns default if not set."""
    table = get_table()
    response = table.get_item(
        Key={'PK': f'PROJ#{project_id}', 'SK': 'META'}
    )
    item = response.get('Item')
    defaults = {
        'ocr_model': 'paddleocr-vl',
        'ocr_options': {}
    }
    if item:
        data = item.get('data', {})
        return {
            'ocr_model': data.get('ocr_model') or defaults['ocr_model'],
            'ocr_options': data.get('ocr_options') or defaults['ocr_options']
        }
    return defaults


def get_document(project_id: str, document_id: str) -> Optional[dict]:
    """Get document from DynamoDB by project_id and document_id."""
    table = get_table()
    response = table.get_item(
        Key={'PK': f'PROJ#{project_id}', 'SK': f'DOC#{document_id}'}
    )
    item = response.get('Item')
    if item:
        result = decimal_to_python(item)
        return result.get('data', {})
    return None
