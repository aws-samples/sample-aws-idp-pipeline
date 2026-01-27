"""OCR Complete Handler Lambda

Triggered by SNS when SageMaker async inference completes.
Saves results to standard location and updates DynamoDB status.
Scale-in is handled by CloudWatch alarm (10 min fallback).
"""
import json
import os

from shared.ddb_client import (
    update_preprocess_status,
    PreprocessStatus,
    PreprocessType,
)
from shared.s3_analysis import get_s3_client, parse_s3_uri

OUTPUT_BUCKET = os.environ.get('OUTPUT_BUCKET', '')

s3_client = None


def get_s3():
    global s3_client
    if s3_client is None:
        s3_client = get_s3_client()
    return s3_client


def download_json_from_s3(uri: str) -> dict:
    """Download and parse JSON from S3."""
    client = get_s3()
    bucket, key = parse_s3_uri(uri)
    response = client.get_object(Bucket=bucket, Key=key)
    return json.loads(response['Body'].read().decode('utf-8'))


def save_ocr_result(bucket: str, base_path: str, ocr_result: dict) -> str:
    """Save OCR result to paddleocr/ folder under document path."""
    client = get_s3()
    output_key = f'{base_path}/paddleocr/result.json'

    client.put_object(
        Bucket=bucket,
        Key=output_key,
        Body=json.dumps(ocr_result, ensure_ascii=False, indent=2),
        ContentType='application/json'
    )

    output_uri = f's3://{bucket}/{output_key}'
    print(f'OCR result saved to: {output_uri}')
    return output_uri


def handle_success(response_location: str, request_payload: dict):
    """Handle successful inference."""
    metadata = request_payload.get('metadata', {})
    workflow_id = metadata.get('workflow_id')
    document_id = metadata.get('document_id')
    bucket = metadata.get('bucket')
    base_path = metadata.get('base_path')

    print(f'Processing success for workflow={workflow_id}')

    # Download result from SageMaker output location
    result = download_json_from_s3(response_location)

    if not result.get('success', True):
        # Inference returned error in response
        error = result.get('error', 'Unknown error in inference response')
        print(f'Inference returned error: {error}')
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.OCR,
            status=PreprocessStatus.FAILED,
            error=error
        )
        return

    # Save to standard location
    ocr_output_uri = save_ocr_result(bucket, base_path, result)
    page_count = len(result.get('pages', [])) or 1

    print(f'OCR completed: {page_count} pages')
    update_preprocess_status(
        document_id=document_id,
        workflow_id=workflow_id,
        processor=PreprocessType.OCR,
        status=PreprocessStatus.COMPLETED,
        output_uri=ocr_output_uri,
        page_count=page_count
    )


def handle_failure(failure_location: str, request_payload: dict):
    """Handle failed inference."""
    metadata = request_payload.get('metadata', {})
    workflow_id = metadata.get('workflow_id')
    document_id = metadata.get('document_id')

    print(f'Processing failure for workflow={workflow_id}')

    # Try to get error details
    error = 'SageMaker async inference failed'
    try:
        if failure_location:
            failure_data = download_json_from_s3(failure_location)
            error = failure_data.get('error', error)
    except Exception as e:
        print(f'Could not read failure details: {e}')

    print(f'OCR failed: {error}')
    update_preprocess_status(
        document_id=document_id,
        workflow_id=workflow_id,
        processor=PreprocessType.OCR,
        status=PreprocessStatus.FAILED,
        error=error
    )


def handler(event, _context):
    """Process SNS notification from SageMaker async inference."""
    print(f'Event: {json.dumps(event)}')

    for record in event.get('Records', []):
        try:
            # Parse SNS message
            sns_message = json.loads(record['Sns']['Message'])
            print(f'SNS Message: {json.dumps(sns_message)}')

            # Skip test notifications
            if sns_message.get('eventName') == 'TestNotification':
                print('Skipping test notification')
                continue

            # Extract fields from SageMaker notification
            # Actual structure:
            #   invocationStatus: Completed/Failed
            #   requestParameters.inputLocation: s3://input.json
            #   responseParameters.outputLocation: s3://output.out
            #   responseParameters.failureLocation: s3://failure.out (on failure)
            invocation_status = sns_message.get('invocationStatus')
            request_params = sns_message.get('requestParameters', {})
            response_params = sns_message.get('responseParameters', {})

            input_location = request_params.get('inputLocation')
            response_location = response_params.get('outputLocation')
            failure_location = response_params.get('failureLocation')

            # Download the original request payload from input location
            request_payload = {}
            if input_location:
                try:
                    request_payload = download_json_from_s3(input_location)
                except Exception as e:
                    print(f'Could not download input payload: {e}')

            if invocation_status == 'Completed' and response_location:
                handle_success(response_location, request_payload)
            elif invocation_status == 'Failed':
                handle_failure(failure_location, request_payload)
            else:
                print(f'Unknown invocation status: {invocation_status}')

        except Exception as e:
            print(f'Error processing SNS record: {e}')
            import traceback
            traceback.print_exc()

    return {'statusCode': 200}
