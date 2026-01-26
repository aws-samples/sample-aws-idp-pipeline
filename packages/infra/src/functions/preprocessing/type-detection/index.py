"""Type Detection Lambda

Detects file type from S3 upload events and distributes to appropriate SQS queues
for parallel preprocessing.
"""
import json
import os

import boto3

from shared.ddb_client import (
    generate_workflow_id,
    create_workflow,
    get_project_language,
    get_document,
    PreprocessType,
)

sqs_client = None
autoscaling_client = None

OCR_QUEUE_URL = os.environ.get('OCR_QUEUE_URL', '')
BDA_QUEUE_URL = os.environ.get('BDA_QUEUE_URL', '')
TRANSCRIBE_QUEUE_URL = os.environ.get('TRANSCRIBE_QUEUE_URL', '')
WORKFLOW_QUEUE_URL = os.environ.get('WORKFLOW_QUEUE_URL', '')
SAGEMAKER_ENDPOINT_NAME = os.environ.get('SAGEMAKER_ENDPOINT_NAME', '')

MIME_TYPE_MAP = {
    # Documents
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'txt': 'text/plain',
    'csv': 'text/csv',
    # Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',
    'webp': 'image/webp',
    # Videos
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    # Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
}


def get_sqs_client():
    global sqs_client
    if sqs_client is None:
        sqs_client = boto3.client(
            'sqs',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return sqs_client


def get_autoscaling_client():
    global autoscaling_client
    if autoscaling_client is None:
        autoscaling_client = boto3.client(
            'application-autoscaling',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return autoscaling_client


def trigger_sagemaker_scale_out():
    """Trigger immediate SageMaker scale-out by temporarily setting MinCapacity to 1."""
    if not SAGEMAKER_ENDPOINT_NAME:
        return

    try:
        client = get_autoscaling_client()
        resource_id = f'endpoint/{SAGEMAKER_ENDPOINT_NAME}/variant/AllTraffic'

        # Re-register scalable target with MinCapacity=1 to force scale-out
        client.register_scalable_target(
            ServiceNamespace='sagemaker',
            ResourceId=resource_id,
            ScalableDimension='sagemaker:variant:DesiredInstanceCount',
            MinCapacity=1,
            MaxCapacity=1,
        )
        print(f'Triggered SageMaker scale-out: {SAGEMAKER_ENDPOINT_NAME}')

        # Immediately restore MinCapacity to 0 (scaling policies will manage scale-in)
        client.register_scalable_target(
            ServiceNamespace='sagemaker',
            ResourceId=resource_id,
            ScalableDimension='sagemaker:variant:DesiredInstanceCount',
            MinCapacity=0,
            MaxCapacity=1,
        )
    except Exception as e:
        print(f'Failed to trigger SageMaker scale-out: {e}')


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


def extract_project_id(object_key: str) -> str:
    """Extract project_id from S3 object key.
    Expected format: projects/{project_id}/documents/{document_id}/{file_name}
    """
    parts = object_key.split('/')
    if len(parts) >= 2 and parts[0] == 'projects':
        return parts[1]
    return 'default'


def extract_document_id(object_key: str) -> str:
    """Extract document_id from S3 object key.
    Expected format: projects/{project_id}/documents/{document_id}/{file_name}
    """
    parts = object_key.split('/')
    try:
        doc_index = parts.index('documents')
        if doc_index + 1 < len(parts):
            return parts[doc_index + 1]
    except ValueError:
        pass
    return ''


def parse_eventbridge_s3_event(body: dict) -> dict | None:
    if body.get('detail-type') != 'Object Created':
        return None

    detail = body.get('detail', {})
    bucket_name = detail.get('bucket', {}).get('name')
    object_key = detail.get('object', {}).get('key')

    if not bucket_name or not object_key:
        return None

    file_name = object_key.split('/')[-1]
    project_id = extract_project_id(object_key)
    document_id = extract_document_id(object_key)

    return {
        'project_id': project_id,
        'document_id': document_id,
        'file_uri': f's3://{bucket_name}/{object_key}',
        'file_name': file_name,
        'file_type': get_mime_type(file_name),
    }


def send_to_queue(queue_url: str, message: dict) -> None:
    """Send message to SQS queue."""
    client = get_sqs_client()
    client.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(message)
    )


def distribute_to_queues(
    workflow_id: str,
    document_id: str,
    project_id: str,
    file_uri: str,
    file_name: str,
    file_type: str,
    language: str,
    use_bda: bool
) -> dict:
    """Distribute preprocessing tasks to appropriate queues based on file type."""
    is_pdf = file_type == 'application/pdf'
    is_image = file_type.startswith('image/')
    is_video = file_type.startswith('video/')
    is_audio = file_type.startswith('audio/')

    base_message = {
        'workflow_id': workflow_id,
        'document_id': document_id,
        'project_id': project_id,
        'file_uri': file_uri,
        'file_name': file_name,
        'file_type': file_type,
        'language': language,
    }

    queues_sent = []

    # OCR Queue (PDF or Image)
    if is_pdf or is_image:
        send_to_queue(OCR_QUEUE_URL, {
            **base_message,
            'processor': PreprocessType.OCR,
        })
        queues_sent.append('ocr')
        print(f'Sent to OCR queue: {workflow_id}')

        # Trigger immediate SageMaker scale-out (bypass CloudWatch metric delay)
        trigger_sagemaker_scale_out()

    # BDA Queue (if use_bda is enabled)
    if use_bda:
        send_to_queue(BDA_QUEUE_URL, {
            **base_message,
            'processor': PreprocessType.BDA,
        })
        queues_sent.append('bda')
        print(f'Sent to BDA queue: {workflow_id}')

    # Transcribe Queue (Video or Audio)
    if is_video or is_audio:
        send_to_queue(TRANSCRIBE_QUEUE_URL, {
            **base_message,
            'processor': PreprocessType.TRANSCRIBE,
        })
        queues_sent.append('transcribe')
        print(f'Sent to Transcribe queue: {workflow_id}')

    # Always send to Workflow Queue (Step Functions will poll for completion)
    send_to_queue(WORKFLOW_QUEUE_URL, {
        **base_message,
        'processing_type': get_processing_type(file_type),
        'use_bda': use_bda,
    })
    queues_sent.append('workflow')
    print(f'Sent to Workflow queue: {workflow_id}')

    return {'queues_sent': queues_sent}


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    results = []

    for record in event.get('Records', []):
        try:
            body = json.loads(record.get('body', '{}'))
            parsed = parse_eventbridge_s3_event(body)

            if not parsed:
                print(f"Skipping unsupported event: {body.get('detail-type')}")
                continue

            project_id = parsed['project_id']
            document_id = parsed['document_id']
            file_uri = parsed['file_uri']
            file_name = parsed['file_name']
            file_type = parsed['file_type']

            if not document_id:
                print('Skipping event: document_id not found in path')
                continue

            workflow_id = generate_workflow_id()

            # Get project language setting
            language = get_project_language(project_id)
            print(f'Project {project_id} language: {language}')

            # Get document settings (use_bda)
            document = get_document(project_id, document_id)
            use_bda = document.get('use_bda', False) if document else False
            print(f'Document {document_id} use_bda: {use_bda}')

            # Create workflow record with preprocess field
            # execution_arn will be empty initially, updated by Step Functions trigger
            create_workflow(
                workflow_id=workflow_id,
                document_id=document_id,
                project_id=project_id,
                file_uri=file_uri,
                file_name=file_name,
                file_type=file_type,
                execution_arn='',
                language=language,
                use_bda=use_bda,
            )
            print(f'Created workflow record: {workflow_id}')

            # Distribute to preprocessing queues
            distribution = distribute_to_queues(
                workflow_id=workflow_id,
                document_id=document_id,
                project_id=project_id,
                file_uri=file_uri,
                file_name=file_name,
                file_type=file_type,
                language=language,
                use_bda=use_bda,
            )

            results.append({
                'workflow_id': workflow_id,
                'document_id': document_id,
                'project_id': project_id,
                'file_type': file_type,
                'queues_sent': distribution['queues_sent'],
                'status': 'distributed'
            })

        except Exception as e:
            print(f'Error processing record: {e}')
            import traceback
            traceback.print_exc()
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
