import json
import os
import uuid
from datetime import datetime
import boto3

sfn_client = None
STEP_FUNCTION_ARN = os.environ.get('STEP_FUNCTION_ARN')

MIME_TYPE_MAP = {
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',
    'webp': 'image/webp',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'txt': 'text/plain',
    'csv': 'text/csv',
}


def get_sfn_client():
    global sfn_client
    if sfn_client is None:
        sfn_client = boto3.client(
            'stepfunctions',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return sfn_client


def get_mime_type(file_name: str) -> str:
    ext = file_name.lower().split('.')[-1]
    return MIME_TYPE_MAP.get(ext, 'application/octet-stream')


def get_processing_type(mime_type: str) -> str:
    if mime_type.startswith('image/'):
        return 'image'
    elif mime_type.startswith('video/'):
        return 'video'
    elif mime_type.startswith('audio/'):
        return 'audio'
    else:
        return 'document'


def parse_eventbridge_s3_event(body: dict) -> dict | None:
    """Parse EventBridge S3 Object Created event."""
    if body.get('detail-type') != 'Object Created':
        return None

    detail = body.get('detail', {})
    bucket_name = detail.get('bucket', {}).get('name')
    object_key = detail.get('object', {}).get('key')

    if not bucket_name or not object_key:
        return None

    file_name = object_key.split('/')[-1]

    return {
        'document_id': str(uuid.uuid4()),
        'file_uri': f's3://{bucket_name}/{object_key}',
        'file_name': file_name,
        'file_type': get_mime_type(file_name),
    }


def parse_custom_event(body: dict) -> dict | None:
    """Parse custom document_uploaded event."""
    if body.get('event_type') != 'document_uploaded':
        return None

    file_uri = body.get('file_uri')
    if not file_uri:
        return None

    file_name = body.get('file_name', '')

    return {
        'document_id': body.get('document_id', str(uuid.uuid4())),
        'file_uri': file_uri,
        'file_name': file_name,
        'file_type': body.get('file_type') or get_mime_type(file_name),
    }


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    results = []

    for record in event.get('Records', []):
        try:
            body = json.loads(record.get('body', '{}'))

            parsed = parse_eventbridge_s3_event(body) or parse_custom_event(body)

            if not parsed:
                print(f"Skipping unsupported event: {body.get('detail-type') or body.get('event_type')}")
                continue

            document_id = parsed['document_id']
            file_uri = parsed['file_uri']
            file_name = parsed['file_name']
            file_type = parsed['file_type']

            processing_type = get_processing_type(file_type)

            sfn_input = {
                'document_id': document_id,
                'file_uri': file_uri,
                'file_name': file_name,
                'file_type': file_type,
                'processing_type': processing_type,
                'triggered_at': datetime.utcnow().isoformat()
            }

            client = get_sfn_client()
            execution_name = f'{document_id[:8]}-{datetime.utcnow().strftime("%Y%m%d%H%M%S")}'

            response = client.start_execution(
                stateMachineArn=STEP_FUNCTION_ARN,
                name=execution_name,
                input=json.dumps(sfn_input)
            )

            print(f'Started Step Function execution: {response["executionArn"]}')

            results.append({
                'document_id': document_id,
                'execution_arn': response['executionArn'],
                'status': 'started'
            })

        except Exception as e:
            print(f'Error processing record: {e}')
            results.append({
                'error': str(e),
                'status': 'failed'
            })

    return {
        'statusCode': 200,
        'body': json.dumps({
            'processed': len(results),
            'results': results
        })
    }
