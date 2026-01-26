"""OCR Invoker Lambda

Receives PDF/Image files from SQS queue and invokes SageMaker async inference.
Does NOT poll for results - completion is handled by SNS callback.
"""
import json
import os
from datetime import datetime, timezone

import boto3

from shared.ddb_client import (
    update_preprocess_status,
    PreprocessStatus,
    PreprocessType,
)
from shared.s3_analysis import get_s3_client, parse_s3_uri

SAGEMAKER_ENDPOINT_NAME = os.environ.get('SAGEMAKER_ENDPOINT_NAME', '')
OUTPUT_BUCKET = os.environ.get('OUTPUT_BUCKET', '')

SUPPORTED_MIME_TYPES = {
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/gif',
    'image/bmp',
    'image/webp',
}

sagemaker_runtime = None
sagemaker_client = None


def get_sagemaker_runtime():
    global sagemaker_runtime
    if sagemaker_runtime is None:
        sagemaker_runtime = boto3.client(
            'sagemaker-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return sagemaker_runtime


def get_sagemaker_client():
    global sagemaker_client
    if sagemaker_client is None:
        sagemaker_client = boto3.client(
            'sagemaker',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return sagemaker_client


def ensure_endpoint_running():
    """Request scale-out to ensure endpoint has at least 1 instance.

    This is idempotent - if already at 1 instance, nothing happens.
    """
    if not SAGEMAKER_ENDPOINT_NAME:
        return

    try:
        client = get_sagemaker_client()
        client.update_endpoint_weights_and_capacities(
            EndpointName=SAGEMAKER_ENDPOINT_NAME,
            DesiredWeightsAndCapacities=[{
                'VariantName': 'AllTraffic',
                'DesiredInstanceCount': 1
            }]
        )
        print(f'Requested scale-out for {SAGEMAKER_ENDPOINT_NAME}')
    except Exception as e:
        # Don't fail the job if scale-out request fails
        print(f'Scale-out request failed (non-fatal): {e}')


def get_document_base_path(file_uri: str) -> tuple[str, str]:
    """Extract bucket and document base path from file URI."""
    bucket, key = parse_s3_uri(file_uri)
    key_parts = key.split('/')

    if 'documents' in key_parts:
        doc_idx = key_parts.index('documents')
        base_path = '/'.join(key_parts[:doc_idx + 2])
    else:
        base_path = '/'.join(key_parts[:-1])

    return bucket, base_path


def invoke_async_inference(
    file_uri: str,
    workflow_id: str,
    document_id: str,
    project_id: str,
) -> str:
    """Invoke SageMaker async inference and return immediately."""
    client = get_sagemaker_runtime()
    s3_client = get_s3_client()

    bucket, base_path = get_document_base_path(file_uri)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    inference_id = f'{workflow_id[:16]}-{timestamp}'

    # Prepare inference request with metadata for SNS callback
    inference_request = {
        's3_uri': file_uri,
        'model': 'paddleocr-vl',
        'model_options': {},
        'metadata': {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'base_path': base_path,
            'bucket': bucket,
        }
    }

    # Upload input request to S3
    input_key = f'{base_path}/paddleocr/input.json'
    s3_client.put_object(
        Bucket=bucket,
        Key=input_key,
        Body=json.dumps(inference_request, ensure_ascii=False, indent=2).encode('utf-8'),
        ContentType='application/json'
    )
    input_location = f's3://{bucket}/{input_key}'

    print(f'Invoking async inference: endpoint={SAGEMAKER_ENDPOINT_NAME}, input={input_location}')

    response = client.invoke_endpoint_async(
        EndpointName=SAGEMAKER_ENDPOINT_NAME,
        ContentType='application/json',
        InputLocation=input_location,
        InvocationTimeoutSeconds=3600,
        InferenceId=inference_id,
    )

    output_location = response.get('OutputLocation', '')
    print(f'Async inference invoked: inference_id={inference_id}, output={output_location}')
    return output_location


def process_message(message: dict) -> dict:
    """Process a single message from the queue."""
    workflow_id = message.get('workflow_id')
    document_id = message.get('document_id')
    project_id = message.get('project_id')
    file_uri = message.get('file_uri')
    file_type = message.get('file_type')

    print(f'Processing OCR job: workflow={workflow_id}, file={file_uri}')

    # Request scale-out immediately (idempotent - safe if already running)
    ensure_endpoint_running()

    # Check if file type is supported
    if file_type not in SUPPORTED_MIME_TYPES:
        print(f'Skipping unsupported file type: {file_type}')
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.OCR,
            status=PreprocessStatus.SKIPPED,
            reason=f'File type {file_type} not supported'
        )
        return {'status': 'skipped', 'reason': f'Unsupported file type: {file_type}'}

    try:
        # Update status to processing
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.OCR,
            status=PreprocessStatus.PROCESSING
        )

        # Invoke async inference (returns immediately)
        output_location = invoke_async_inference(
            file_uri=file_uri,
            workflow_id=workflow_id,
            document_id=document_id,
            project_id=project_id
        )

        # Return immediately - SNS callback will handle completion
        return {
            'status': 'invoked',
            'output_location': output_location
        }

    except Exception as e:
        print(f'Error invoking OCR: {e}')
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.OCR,
            status=PreprocessStatus.FAILED,
            error=str(e)
        )
        raise


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    results = []

    for record in event.get('Records', []):
        try:
            message = json.loads(record.get('body', '{}'))
            result = process_message(message)
            results.append({
                'workflow_id': message.get('workflow_id'),
                **result
            })

        except Exception as e:
            print(f'Error processing record: {e}')
            import traceback
            traceback.print_exc()
            results.append({
                'status': 'failed',
                'error': str(e)
            })

    return {
        'statusCode': 200,
        'body': json.dumps({
            'processed': len(results),
            'results': results
        })
    }
