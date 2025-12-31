import json
import os
import boto3

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

    document_id = event.get('document_id')
    bda_invocation_arn = event.get('bda_invocation_arn')
    status = event.get('status')

    if status == 'SKIPPED':
        print('BDA was skipped, passing through')
        return {
            **event,
            'status': 'Success',
            'bda_metadata_uri': None
        }

    if not bda_invocation_arn:
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
        print(f'BDA status for {document_id}: {bda_status}')

        if bda_status == 'Success':
            output_config = response.get('outputConfiguration', {})
            s3_uri = output_config.get('s3Uri', '').rstrip('/')

            if s3_uri.endswith('job_metadata.json'):
                metadata_uri = s3_uri
                output_dir = s3_uri.rsplit('/job_metadata.json', 1)[0]
            else:
                metadata_uri = f'{s3_uri}/job_metadata.json'
                output_dir = s3_uri

            return {
                **event,
                'status': 'Success',
                'bda_metadata_uri': metadata_uri,
                'bda_output_uri': output_dir
            }

        elif bda_status in ['Created', 'InProgress']:
            return {
                **event,
                'status': 'InProgress'
            }

        elif bda_status in ['ServiceError', 'ClientError', 'Failed']:
            error_message = response.get('errorMessage', 'Unknown error')
            print(f'BDA failed: {error_message}')
            return {
                **event,
                'status': 'Failed',
                'error': error_message
            }

        else:
            return {
                **event,
                'status': bda_status
            }

    except Exception as e:
        print(f'Error checking BDA status: {e}')
        return {
            **event,
            'status': 'Failed',
            'error': str(e)
        }
