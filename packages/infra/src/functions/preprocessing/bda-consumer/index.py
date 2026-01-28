"""BDA Consumer Lambda

Receives documents from SQS queue and processes them using Bedrock Data Automation.
Polls for completion and updates DynamoDB preprocess status.
"""
import json
import os
import time
from datetime import datetime, timezone

import boto3

from shared.ddb_client import (
    update_preprocess_status,
    PreprocessStatus,
    PreprocessType,
    record_step_start,
    record_step_complete,
    record_step_error,
    record_step_skipped,
    StepName,
)

BDA_PROJECT_NAME = os.environ.get('BDA_PROJECT_NAME', 'idp-v2-bda-project')
BDA_OUTPUT_BUCKET = os.environ.get('BDA_OUTPUT_BUCKET', '')

SUPPORTED_MIME_TYPES = {
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/gif',
    'image/bmp',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/flac',
    'audio/ogg',
    'audio/wav',
}

POLL_INTERVAL_SECONDS = 10
MAX_POLL_ATTEMPTS = 84  # ~14 minutes max

bda_client = None
bda_runtime_client = None


def get_bda_client():
    global bda_client
    if bda_client is None:
        bda_client = boto3.client(
            'bedrock-data-automation',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return bda_client


def get_bda_runtime_client():
    global bda_runtime_client
    if bda_runtime_client is None:
        bda_runtime_client = boto3.client(
            'bedrock-data-automation-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return bda_runtime_client


def get_standard_output_config():
    """Standard output configuration for BDA project."""
    return {
        'document': {
            'extraction': {
                'granularity': {'types': ['DOCUMENT', 'PAGE', 'ELEMENT']},
                'boundingBox': {'state': 'ENABLED'}
            },
            'generativeField': {'state': 'ENABLED'},
            'outputFormat': {
                'textFormat': {'types': ['MARKDOWN']},
                'additionalFileFormat': {'state': 'ENABLED'}
            }
        }
    }


def extract_document_id(file_uri: str) -> str:
    """Extract document_id from file_uri."""
    parts = file_uri.split('/')
    try:
        doc_index = parts.index('documents')
        if doc_index + 1 < len(parts):
            return parts[doc_index + 1]
    except ValueError:
        pass
    return ''


def get_or_create_bda_project(client) -> str:
    """Get existing or create new BDA project."""
    try:
        projects = client.list_data_automation_projects()
        for project in projects.get('projects', []):
            if project['projectName'] == BDA_PROJECT_NAME:
                project_arn = project['projectArn']
                print(f'Using existing BDA project: {project_arn}')
                return project_arn

        print(f'Creating new BDA project: {BDA_PROJECT_NAME}')
        response = client.create_data_automation_project(
            projectName=BDA_PROJECT_NAME,
            projectDescription='IDP-v2 document analysis project',
            standardOutputConfiguration=get_standard_output_config()
        )
        return response['projectArn']

    except Exception as e:
        print(f'Error creating BDA project: {e}')
        raise


def start_bda_job(
    file_uri: str,
    project_id: str,
    document_id: str,
    workflow_id: str
) -> tuple[str, str]:
    """Start BDA async job and return invocation ARN and output URI."""
    client = get_bda_client()
    runtime_client = get_bda_runtime_client()
    project_arn = get_or_create_bda_project(client)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    if document_id:
        output_prefix = f'projects/{project_id}/documents/{document_id}/bda-output/{timestamp}'
    else:
        output_prefix = f'bda-output/{workflow_id}/{timestamp}'
    output_uri = f's3://{BDA_OUTPUT_BUCKET}/{output_prefix}'

    session = boto3.Session()
    region = session.region_name or 'us-east-1'
    sts_client = boto3.client('sts')
    account_id = sts_client.get_caller_identity()['Account']

    response = runtime_client.invoke_data_automation_async(
        inputConfiguration={
            's3Uri': file_uri
        },
        outputConfiguration={
            's3Uri': output_uri
        },
        dataAutomationConfiguration={
            'dataAutomationProjectArn': project_arn,
            'stage': 'LIVE'
        },
        dataAutomationProfileArn=f'arn:aws:bedrock:{region}:{account_id}:data-automation-profile/us.data-automation-v1'
    )

    invocation_arn = response['invocationArn']
    print(f'BDA invocation started: {invocation_arn}')

    return invocation_arn, output_uri


def poll_bda_status(invocation_arn: str) -> tuple[str, str | None]:
    """Poll BDA status until completion or failure.

    Returns:
        tuple of (status, output_uri or error_message)
    """
    runtime_client = get_bda_runtime_client()

    for attempt in range(MAX_POLL_ATTEMPTS):
        response = runtime_client.get_data_automation_status(
            invocationArn=invocation_arn
        )

        bda_status = response.get('status', 'Unknown')
        print(f'BDA status (attempt {attempt + 1}): {bda_status}')

        if bda_status == 'Success':
            output_config = response.get('outputConfiguration', {})
            s3_uri = output_config.get('s3Uri', '').rstrip('/')

            if s3_uri.endswith('job_metadata.json'):
                output_dir = s3_uri.rsplit('/job_metadata.json', 1)[0]
            else:
                output_dir = s3_uri

            return 'Success', output_dir

        elif bda_status in ['ServiceError', 'ClientError', 'Failed']:
            error_message = response.get('errorMessage', 'Unknown error')
            return 'Failed', error_message

        elif bda_status in ['Created', 'InProgress']:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        else:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

    return 'Timeout', 'BDA processing timed out'


def process_message(message: dict) -> dict:
    """Process a single message from the queue."""
    workflow_id = message.get('workflow_id')
    document_id = message.get('document_id')
    project_id = message.get('project_id')
    file_uri = message.get('file_uri')
    file_type = message.get('file_type')

    print(f'Processing BDA job: workflow={workflow_id}, file={file_uri}')

    # Check if file type is supported
    if file_type not in SUPPORTED_MIME_TYPES:
        print(f'Skipping unsupported file type: {file_type}')
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.BDA,
            status=PreprocessStatus.SKIPPED,
            reason=f'File type {file_type} not supported'
        )
        record_step_skipped(workflow_id, StepName.BDA_PROCESSOR, f'File type {file_type} not supported')
        return {'status': 'skipped', 'reason': f'Unsupported file type: {file_type}'}

    # Update STEP record to in_progress
    record_step_start(workflow_id, StepName.BDA_PROCESSOR)

    # Update preprocess status to processing
    update_preprocess_status(
        document_id=document_id,
        workflow_id=workflow_id,
        processor=PreprocessType.BDA,
        status=PreprocessStatus.PROCESSING
    )

    try:
        # Start BDA job
        invocation_arn, output_uri = start_bda_job(
            file_uri=file_uri,
            project_id=project_id,
            document_id=document_id,
            workflow_id=workflow_id
        )

        # Poll for completion
        status, result = poll_bda_status(invocation_arn)

        if status == 'Success':
            print(f'BDA completed: {result}')
            update_preprocess_status(
                document_id=document_id,
                workflow_id=workflow_id,
                processor=PreprocessType.BDA,
                status=PreprocessStatus.COMPLETED,
                output_uri=result,
                invocation_arn=invocation_arn
            )
            record_step_complete(workflow_id, StepName.BDA_PROCESSOR)
            return {
                'status': 'completed',
                'output_uri': result,
                'invocation_arn': invocation_arn
            }
        else:
            print(f'BDA failed: {result}')
            update_preprocess_status(
                document_id=document_id,
                workflow_id=workflow_id,
                processor=PreprocessType.BDA,
                status=PreprocessStatus.FAILED,
                error=result,
                invocation_arn=invocation_arn
            )
            record_step_error(workflow_id, StepName.BDA_PROCESSOR, result or 'Unknown error')
            return {
                'status': 'failed',
                'error': result,
                'invocation_arn': invocation_arn
            }

    except Exception as e:
        print(f'Error processing BDA: {e}')
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.BDA,
            status=PreprocessStatus.FAILED,
            error=str(e)
        )
        record_step_error(workflow_id, StepName.BDA_PROCESSOR, str(e))
        raise


def handler(event, context):
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
