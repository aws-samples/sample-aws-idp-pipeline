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


class WorkflowStatus:
    PENDING = 'pending'
    IN_PROGRESS = 'in_progress'
    COMPLETED = 'completed'
    FAILED = 'failed'


class StepName:
    PREPROCESSOR = 'preprocessor'
    BDA_PROCESSOR = 'bda_processor'
    BDA_STATUS_CHECKER = 'bda_status_checker'
    FORMAT_PARSER = 'format_parser'
    PADDLEOCR_PROCESSOR = 'paddleocr_processor'
    SEGMENT_BUILDER = 'segment_builder'
    SEGMENT_ANALYZER = 'segment_analyzer'
    DOCUMENT_SUMMARIZER = 'document_summarizer'

    ORDER = [
        'preprocessor',
        'bda_processor',
        'bda_status_checker',
        'format_parser',
        'paddleocr_processor',
        'segment_builder',
        'segment_analyzer',
        'document_summarizer'
    ]

    LABELS = {
        'preprocessor': 'Preprocessing',
        'bda_processor': 'BDA Processing',
        'bda_status_checker': 'BDA Status Check',
        'format_parser': 'Format Parsing',
        'paddleocr_processor': 'PaddleOCR Processing',
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
    language: str = 'en'
) -> dict:
    table = get_table()
    now = now_iso()

    # Main workflow item under document
    workflow_item = {
        'PK': f'DOC#{document_id}',
        'SK': f'WF#{workflow_id}',
        'data': {
            'project_id': project_id,
            'file_uri': file_uri,
            'file_name': file_name,
            'file_type': file_type,
            'execution_arn': execution_arn,
            'status': WorkflowStatus.PENDING,
            'language': language,
            'total_segments': 0
        },
        'created_at': now,
        'updated_at': now
    }

    # Initialize STEP row with all steps as pending
    steps_data = {
        'current_step': ''
    }
    for step_name in StepName.ORDER:
        steps_data[step_name] = {
            'status': WorkflowStatus.PENDING,
            'label': StepName.LABELS.get(step_name, step_name)
        }

    steps_item = {
        'PK': f'WF#{workflow_id}',
        'SK': 'STEP',
        'data': steps_data,
        'created_at': now,
        'updated_at': now
    }

    with table.batch_writer() as batch:
        batch.put_item(Item=workflow_item)
        batch.put_item(Item=steps_item)

    return workflow_item


def update_workflow_status(document_id: str, workflow_id: str, status: str, **kwargs) -> dict:
    table = get_table()
    now = now_iso()

    workflow = get_workflow(document_id, workflow_id)
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
        Key={'PK': f'DOC#{document_id}', 'SK': f'WF#{workflow_id}'},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues=expr_values
    )

    return decimal_to_python({'data': data, 'updated_at': now})


def get_workflow(document_id: str, workflow_id: str) -> Optional[dict]:
    table = get_table()
    response = table.get_item(
        Key={'PK': f'DOC#{document_id}', 'SK': f'WF#{workflow_id}'}
    )
    item = response.get('Item')
    return decimal_to_python(item) if item else None


def get_steps(workflow_id: str) -> Optional[dict]:
    """Get workflow steps progress (SK: STEP)"""
    table = get_table()
    response = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'}
    )
    item = response.get('Item')
    return decimal_to_python(item) if item else None


def update_workflow_total_segments(document_id: str, workflow_id: str, total_segments: int) -> dict:
    """Update workflow total_segments count"""
    table = get_table()
    now = now_iso()

    response = table.update_item(
        Key={'PK': f'DOC#{document_id}', 'SK': f'WF#{workflow_id}'},
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

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'},
        UpdateExpression='SET #data = :data',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data},
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

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'},
        UpdateExpression='SET #data = :data, updated_at = :updated_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':updated_at': now},
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
