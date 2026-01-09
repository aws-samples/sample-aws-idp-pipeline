import json
import os

import boto3

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    StepName,
)
from shared.websocket import notify_step_start, notify_step_complete, notify_step_error

bda_client = None


def get_bda_client():
    global bda_client
    if bda_client is None:
        bda_client = boto3.client(
            'bedrock-data-automation-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return bda_client


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    bda_invocation_arn = event.get('bda_invocation_arn')
    status = event.get('status')

    is_first_check = event.get('_bda_check_started') is None

    if is_first_check:
        record_step_start(workflow_id, StepName.BDA_STATUS_CHECKER)
        notify_step_start(workflow_id, 'BdaStatusChecker')

    if status == 'SKIPPED':
        print('BDA was skipped, passing through')
        record_step_complete(
            workflow_id,
            StepName.BDA_STATUS_CHECKER,
            skipped=True
        )
        notify_step_complete(workflow_id, 'BdaStatusChecker', message='Skipped')
        return {
            **event,
            'status': 'Success',
            'bda_metadata_uri': None
        }

    if not bda_invocation_arn:
        record_step_complete(
            workflow_id,
            StepName.BDA_STATUS_CHECKER,
            skipped=True
        )
        notify_step_complete(workflow_id, 'BdaStatusChecker', message='No BDA invocation')
        return {
            **event,
            'status': 'Success',
            'bda_metadata_uri': None
        }

    try:
        client = get_bda_client()
        response = client.get_data_automation_status(
            invocationArn=bda_invocation_arn
        )

        bda_status = response.get('status', 'Unknown')
        print(f'BDA status for {workflow_id}: {bda_status}')

        if bda_status == 'Success':
            output_config = response.get('outputConfiguration', {})
            s3_uri = output_config.get('s3Uri', '').rstrip('/')

            if s3_uri.endswith('job_metadata.json'):
                metadata_uri = s3_uri
                output_dir = s3_uri.rsplit('/job_metadata.json', 1)[0]
            else:
                metadata_uri = f'{s3_uri}/job_metadata.json'
                output_dir = s3_uri

            record_step_complete(
                workflow_id,
                StepName.BDA_STATUS_CHECKER,
                bda_output_uri=output_dir
            )
            notify_step_complete(workflow_id, 'BdaStatusChecker')

            return {
                **event,
                'status': 'Success',
                'bda_metadata_uri': metadata_uri,
                'bda_output_uri': output_dir
            }

        elif bda_status in ['Created', 'InProgress']:
            return {
                **event,
                'status': 'InProgress',
                '_bda_check_started': True
            }

        elif bda_status in ['ServiceError', 'ClientError', 'Failed']:
            error_message = response.get('errorMessage', 'Unknown error')
            print(f'BDA failed: {error_message}')
            record_step_error(workflow_id, StepName.BDA_STATUS_CHECKER, error_message)
            notify_step_error(workflow_id, 'BdaStatusChecker', error_message)
            return {
                **event,
                'status': 'Failed',
                'error': error_message
            }

        else:
            return {
                **event,
                'status': bda_status,
                '_bda_check_started': True
            }

    except Exception as e:
        print(f'Error checking BDA status: {e}')
        record_step_error(workflow_id, StepName.BDA_STATUS_CHECKER, str(e))
        notify_step_error(workflow_id, 'BdaStatusChecker', str(e))
        return {
            **event,
            'status': 'Failed',
            'error': str(e)
        }
