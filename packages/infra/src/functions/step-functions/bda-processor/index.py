import json
import os
from datetime import datetime, timezone

import boto3

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    update_workflow_status,
    StepName,
    WorkflowStatus,
)
from shared.websocket import notify_step_start, notify_step_complete, notify_step_error

BDA_PROJECT_NAME = os.environ.get('BDA_PROJECT_NAME', 'idp-v2-bda-project')
BDA_OUTPUT_BUCKET = os.environ.get('BDA_OUTPUT_BUCKET')

SUPPORTED_MIME_TYPES = {
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/tiff',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/csv',
}

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


def get_or_create_bda_project(client) -> str:
    try:
        projects = client.list_data_automation_projects()
        for project in projects.get('projects', []):
            if project['projectName'] == BDA_PROJECT_NAME:
                project_arn = project['projectArn']
                print(f'Updating existing BDA project: {project_arn}')
                client.update_data_automation_project(
                    projectArn=project_arn,
                    standardOutputConfiguration=get_standard_output_config()
                )
                return project_arn

        response = client.create_data_automation_project(
            projectName=BDA_PROJECT_NAME,
            projectDescription='IDP-v2 document analysis project',
            standardOutputConfiguration=get_standard_output_config()
        )
        return response['projectArn']

    except Exception as e:
        print(f'Error creating BDA project: {e}')
        raise


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    processing_type = event.get('processing_type', 'document')

    if not all([workflow_id, file_uri, file_type]):
        return {
            'statusCode': 400,
            'body': 'Missing required fields: workflow_id, file_uri, file_type'
        }

    record_step_start(workflow_id, StepName.BDA_PROCESSOR)
    notify_step_start(workflow_id, 'BdaProcessor')
    update_workflow_status(workflow_id, WorkflowStatus.IN_PROGRESS)

    if file_type not in SUPPORTED_MIME_TYPES:
        print(f'Unsupported file type: {file_type}, skipping BDA')
        record_step_complete(
            workflow_id,
            StepName.BDA_PROCESSOR,
            skipped=True,
            reason=f'File type {file_type} not supported'
        )
        notify_step_complete(workflow_id, 'BdaProcessor', message='Skipped - unsupported file type')

        return {
            **event,
            'status': 'SKIPPED',
            'bda_invocation_arn': None,
            'message': f'File type {file_type} not supported by BDA'
        }

    try:
        client = get_bda_client()
        runtime_client = get_bda_runtime_client()
        project_arn = get_or_create_bda_project(client)

        output_prefix = f'bda-output/{workflow_id}/{datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")}'
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

        record_step_complete(
            workflow_id,
            StepName.BDA_PROCESSOR,
            bda_invocation_arn=invocation_arn
        )
        notify_step_complete(workflow_id, 'BdaProcessor')

        return {
            **event,
            'status': 'STARTED',
            'bda_invocation_arn': invocation_arn,
            'bda_output_uri': output_uri,
            'bda_project_arn': project_arn
        }

    except Exception as e:
        print(f'Error starting BDA: {e}')
        record_step_error(workflow_id, StepName.BDA_PROCESSOR, str(e))
        notify_step_error(workflow_id, 'BdaProcessor', str(e))

        return {
            **event,
            'status': 'FAILED',
            'error': str(e)
        }
