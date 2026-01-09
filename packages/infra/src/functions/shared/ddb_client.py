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
    BDA_PROCESSOR = '01#BdaProcessor'
    BDA_STATUS_CHECKER = '02#BdaStatusChecker'
    DOCUMENT_INDEXER = '03#DocumentIndexer'
    FORMAT_PARSER = '04#FormatParser'
    SEGMENT_ANALYZER = '05#SegmentAnalyzer'
    DOCUMENT_SUMMARIZER = '06#DocumentSummarizer'


def create_workflow(
    workflow_id: str,
    project_id: str,
    file_uri: str,
    file_name: str,
    file_type: str,
    execution_arn: str
) -> dict:
    table = get_table()
    now = now_iso()

    workflow_item = {
        'PK': f'WF#{workflow_id}',
        'SK': 'META',
        'data': {
            'project_id': project_id,
            'file_uri': file_uri,
            'file_name': file_name,
            'file_type': file_type,
            'execution_arn': execution_arn,
            'status': WorkflowStatus.PENDING,
            'total_segments': 0
        },
        'started_at': now
    }

    project_item = {
        'PK': f'PROJ#{project_id}',
        'SK': f'WF#{workflow_id}',
        'data': {
            'status': WorkflowStatus.PENDING,
            'file_uri': file_uri,
            'file_name': file_name
        },
        'started_at': now
    }

    with table.batch_writer() as batch:
        batch.put_item(Item=workflow_item)
        batch.put_item(Item=project_item)

    return workflow_item


def update_workflow_status(workflow_id: str, status: str, **kwargs) -> dict:
    table = get_table()
    now = now_iso()

    workflow = get_workflow(workflow_id)
    if not workflow:
        return {}

    data = workflow.get('data', {})
    data['status'] = status
    for key, value in kwargs.items():
        data[key] = value

    is_terminal = status in [WorkflowStatus.COMPLETED, WorkflowStatus.FAILED]

    if is_terminal:
        table.update_item(
            Key={'PK': f'WF#{workflow_id}', 'SK': 'META'},
            UpdateExpression='SET #data = :data, ended_at = :ended_at',
            ExpressionAttributeNames={'#data': 'data'},
            ExpressionAttributeValues={':data': data, ':ended_at': now}
        )
    else:
        table.update_item(
            Key={'PK': f'WF#{workflow_id}', 'SK': 'META'},
            UpdateExpression='SET #data = :data',
            ExpressionAttributeNames={'#data': 'data'},
            ExpressionAttributeValues={':data': data}
        )

    project_id = data.get('project_id')
    if project_id:
        try:
            proj_response = table.get_item(
                Key={'PK': f'PROJ#{project_id}', 'SK': f'WF#{workflow_id}'}
            )
            proj_item = proj_response.get('Item')
            if proj_item:
                proj_data = proj_item.get('data', {})
                proj_data['status'] = status

                if is_terminal:
                    table.update_item(
                        Key={'PK': f'PROJ#{project_id}', 'SK': f'WF#{workflow_id}'},
                        UpdateExpression='SET #data = :data, ended_at = :ended_at',
                        ExpressionAttributeNames={'#data': 'data'},
                        ExpressionAttributeValues={':data': proj_data, ':ended_at': now}
                    )
                else:
                    table.update_item(
                        Key={'PK': f'PROJ#{project_id}', 'SK': f'WF#{workflow_id}'},
                        UpdateExpression='SET #data = :data',
                        ExpressionAttributeNames={'#data': 'data'},
                        ExpressionAttributeValues={':data': proj_data}
                    )
        except Exception as e:
            print(f'Error updating PROJ record: {e}')

    return decimal_to_python({'data': data, 'ended_at': now if is_terminal else None})


def get_workflow(workflow_id: str) -> Optional[dict]:
    table = get_table()
    response = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'META'}
    )
    item = response.get('Item')
    return decimal_to_python(item) if item else None


def record_step_start(workflow_id: str, step_name: str, **kwargs) -> dict:
    table = get_table()
    now = now_iso()

    data = {
        'status': WorkflowStatus.IN_PROGRESS,
        **kwargs
    }

    item = {
        'PK': f'WF#{workflow_id}',
        'SK': f'STEP#{step_name}',
        'data': data,
        'started_at': now
    }

    table.put_item(Item=item)
    return item


def record_step_complete(workflow_id: str, step_name: str, **kwargs) -> dict:
    table = get_table()
    now = now_iso()

    existing = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'STEP#{step_name}'}
    ).get('Item', {})

    data = existing.get('data', {})
    data['status'] = WorkflowStatus.COMPLETED
    for key, value in kwargs.items():
        data[key] = value

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'STEP#{step_name}'},
        UpdateExpression='SET #data = :data, ended_at = :ended_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':ended_at': now},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def record_step_error(workflow_id: str, step_name: str, error: str) -> dict:
    table = get_table()
    now = now_iso()

    existing = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'STEP#{step_name}'}
    ).get('Item', {})

    data = existing.get('data', {})
    data['status'] = WorkflowStatus.FAILED
    data['error'] = error

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'STEP#{step_name}'},
        UpdateExpression='SET #data = :data, ended_at = :ended_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':ended_at': now},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def save_segment(
    workflow_id: str,
    segment_index: int,
    image_uri: str = '',
    bda_indexer: str = ''
) -> dict:
    table = get_table()
    segment_key = f'{segment_index:04d}'

    item = {
        'PK': f'WF#{workflow_id}',
        'SK': f'SEG#{segment_key}',
        'data': {
            'segment_index': segment_index,
            'image_uri': image_uri,
            'bda_indexer': bda_indexer,
            'format_parser': '',
            'image_analysis': []
        },
        'started_at': now_iso()
    }

    table.put_item(Item=item)
    return item


def update_segment(workflow_id: str, segment_index: int, **kwargs) -> dict:
    table = get_table()
    segment_key = f'{segment_index:04d}'

    existing = table.get_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'SEG#{segment_key}'}
    ).get('Item', {})

    data = existing.get('data', {})
    for key, value in kwargs.items():
        data[key] = value

    response = table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'SEG#{segment_key}'},
        UpdateExpression='SET #data = :data',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data},
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
        UpdateExpression='SET #data = :data, ended_at = :ended_at',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data, ':ended_at': now_iso()},
        ReturnValues='ALL_NEW'
    )
    return decimal_to_python(response.get('Attributes', {}))


def save_connection(workflow_id: str, connection_id: str, ttl_seconds: int = 3600) -> dict:
    table = get_table()
    now = datetime.now(timezone.utc)
    ttl = int(now.timestamp()) + ttl_seconds

    item = {
        'PK': f'WF#{workflow_id}',
        'SK': f'CONN#{connection_id}',
        'data': {
            'connection_id': connection_id
        },
        'started_at': now.isoformat(),
        'ttl': ttl
    }

    table.put_item(Item=item)
    return item


def delete_connection(workflow_id: str, connection_id: str) -> None:
    table = get_table()
    table.delete_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': f'CONN#{connection_id}'}
    )


def get_connections(workflow_id: str) -> list:
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key('PK').eq(f'WF#{workflow_id}') & Key('SK').begins_with('CONN#')
    )
    items = decimal_to_python(response.get('Items', []))
    return [{**item, **item.get('data', {})} for item in items]


def batch_save_segments(workflow_id: str, segments: list) -> int:
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
                    'image_uri': seg.get('image_uri', ''),
                    'bda_indexer': seg.get('bda_indexer', seg.get('content', '')),
                    'format_parser': '',
                    'image_analysis': []
                },
                'started_at': now
            }
            batch.put_item(Item=item)
            count += 1

    return count
