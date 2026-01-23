"""PaddleOCR Processor Lambda

Processes entire document using PaddleOCR via SageMaker Async Inference.
Saves result to paddleocr/result.json for SegmentBuilder to merge later.
Supports: PNG, TIFF, JPEG, PDF (multi-page)

Output: s3://bucket/{base_path}/paddleocr/result.json
"""
import json
import os
import time
import uuid
from urllib.parse import urlparse

import boto3

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    get_project_ocr_settings,
    StepName,
)
from shared.s3_analysis import (
    get_s3_client,
    parse_s3_uri,
)

ENDPOINT_NAME = os.environ.get('PADDLEOCR_ENDPOINT_NAME', 'paddleocr-endpoint')
BUCKET_NAME = os.environ.get('DOCUMENT_BUCKET_NAME', '')

# Supported file types for OCR
SUPPORTED_EXTENSIONS = {'.png', '.tiff', '.tif', '.jpeg', '.jpg', '.pdf'}

sagemaker_client = None


def get_sagemaker_client():
    global sagemaker_client
    if sagemaker_client is None:
        sagemaker_client = boto3.client(
            'sagemaker-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return sagemaker_client


def get_file_extension(file_uri: str) -> str:
    """Get lowercase file extension from URI."""
    path = urlparse(file_uri).path
    ext_idx = path.rfind('.')
    if ext_idx == -1:
        return ''
    return path[ext_idx:].lower()


def is_supported_file(file_uri: str) -> bool:
    """Check if file type is supported for OCR."""
    ext = get_file_extension(file_uri)
    return ext in SUPPORTED_EXTENSIONS


def wait_for_async_result(output_location: str, timeout: int = 600, delete_after: bool = True) -> dict:
    """Wait for SageMaker async inference result and optionally delete the output file."""
    s3 = get_s3_client()
    bucket, key = parse_s3_uri(output_location)

    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            response = s3.get_object(Bucket=bucket, Key=key)
            result = json.loads(response['Body'].read().decode('utf-8'))

            # Delete the temporary output file
            if delete_after:
                try:
                    s3.delete_object(Bucket=bucket, Key=key)
                    print(f'Deleted temporary output: {output_location}')
                except Exception as e:
                    print(f'Failed to delete temporary output: {e}')

            return result
        except s3.exceptions.NoSuchKey:
            time.sleep(5)
        except Exception as e:
            print(f'Error checking result: {e}')
            time.sleep(5)

    raise TimeoutError(f'Async inference timed out after {timeout}s')


def get_document_base_path(file_uri: str) -> tuple[str, str]:
    """Extract bucket and document base path from file URI.

    e.g., s3://bucket/projects/proj_id/documents/doc_id/file.jpg
    returns: (bucket, projects/proj_id/documents/doc_id)
    """
    bucket, key = parse_s3_uri(file_uri)
    key_parts = key.split('/')

    # Find documents folder and include document_id
    if 'documents' in key_parts:
        doc_idx = key_parts.index('documents')
        # Include up to document_id (documents/{doc_id})
        base_path = '/'.join(key_parts[:doc_idx + 2])
    else:
        base_path = '/'.join(key_parts[:-1])

    return bucket, base_path


def save_ocr_output(file_uri: str, ocr_result: dict) -> str:
    """Save OCR result to paddleocr/ folder under document path."""
    s3 = get_s3_client()
    bucket, base_path = get_document_base_path(file_uri)

    output_key = f'{base_path}/paddleocr/result.json'

    s3.put_object(
        Bucket=bucket,
        Key=output_key,
        Body=json.dumps(ocr_result, ensure_ascii=False, indent=2),
        ContentType='application/json'
    )

    output_uri = f's3://{bucket}/{output_key}'
    print(f'OCR result saved to: {output_uri}')
    return output_uri


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    project_id = event.get('project_id', 'default')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')

    # Record step start
    record_step_start(workflow_id, StepName.PADDLEOCR_PROCESSOR)

    # Check if file type is supported
    if not is_supported_file(file_uri):
        print(f'File type not supported for OCR: {file_uri}')
        record_step_complete(workflow_id, StepName.PADDLEOCR_PROCESSOR)
        return {
            **event,
            'paddleocr_status': 'skipped',
            'paddleocr_reason': 'unsupported_file_type'
        }

    # Get project OCR settings
    ocr_settings = get_project_ocr_settings(project_id)
    ocr_model = ocr_settings.get('ocr_model', 'paddleocr-vl')
    ocr_options = ocr_settings.get('ocr_options', {})
    print(f'Project {project_id} OCR settings: model={ocr_model}, options={ocr_options}')

    try:
        sagemaker = get_sagemaker_client()
        s3 = get_s3_client()

        # Get document base path for storing input/output
        bucket, base_path = get_document_base_path(file_uri)

        # Prepare inference input
        job_id = str(uuid.uuid4())

        inference_input = {
            's3_uri': file_uri,
            'model': ocr_model,
            'model_options': ocr_options,
            'metadata': {
                'workflow_id': workflow_id,
                'project_id': project_id,
                'job_id': job_id
            }
        }

        # Upload inference input to S3 under document's paddleocr folder
        input_key = f'{base_path}/paddleocr/input.json'
        s3.put_object(
            Bucket=bucket,
            Key=input_key,
            Body=json.dumps(inference_input),
            ContentType='application/json'
        )

        # Invoke SageMaker async endpoint
        response = sagemaker.invoke_endpoint_async(
            EndpointName=ENDPOINT_NAME,
            InputLocation=f's3://{bucket}/{input_key}',
            ContentType='application/json'
        )

        output_location = response.get('OutputLocation', '')
        print(f'SageMaker async invocation started: {output_location}')

        # Wait for result (longer timeout for multi-page PDF)
        result = wait_for_async_result(output_location, timeout=600)

        if result.get('success'):
            # Save OCR result to paddleocr/ folder (SegmentBuilder will merge later)
            ocr_output_uri = save_ocr_output(file_uri, result)

            # Count pages for reporting
            page_count = len(result.get('pages', [])) or 1

            record_step_complete(workflow_id, StepName.PADDLEOCR_PROCESSOR)

            print(f'OCR completed: {page_count} pages processed, saved to {ocr_output_uri}')

            return {
                **event,
                'paddleocr_status': 'success',
                'paddleocr_model': ocr_model,
                'paddleocr_output_uri': ocr_output_uri,
                'paddleocr_page_count': page_count
            }
        else:
            error_msg = result.get('error', 'Unknown error')
            print(f'OCR failed: {error_msg}')
            record_step_error(workflow_id, StepName.PADDLEOCR_PROCESSOR, error_msg)
            return {
                **event,
                'paddleocr_status': 'failed',
                'paddleocr_error': error_msg
            }

    except Exception as e:
        error_msg = str(e)
        print(f'Error processing document: {error_msg}')
        record_step_error(workflow_id, StepName.PADDLEOCR_PROCESSOR, error_msg)
        return {
            **event,
            'paddleocr_status': 'error',
            'paddleocr_error': error_msg
        }
