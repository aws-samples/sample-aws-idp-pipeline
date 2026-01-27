"""Step Function Trigger Lambda

Triggered by Workflow Queue (after type-detection distributes messages).
The workflow record is already created by type-detection Lambda.
This Lambda starts the Step Functions execution and updates the execution_arn.
"""
import json
import os
from datetime import datetime

import boto3

from shared.ddb_client import get_workflow, update_workflow_status, WorkflowStatus

sfn_client = None
STEP_FUNCTION_ARN = os.environ.get('STEP_FUNCTION_ARN')


def get_sfn_client():
    global sfn_client
    if sfn_client is None:
        sfn_client = boto3.client(
            'stepfunctions',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return sfn_client


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    results = []

    for record in event.get('Records', []):
        try:
            body = json.loads(record.get('body', '{}'))

            # Message from type-detection via Workflow Queue
            workflow_id = body.get('workflow_id')
            document_id = body.get('document_id')
            project_id = body.get('project_id')
            file_uri = body.get('file_uri')
            file_name = body.get('file_name')
            file_type = body.get('file_type')
            language = body.get('language', 'en')
            use_bda = body.get('use_bda', False)
            processing_type = body.get('processing_type', 'document')

            if not workflow_id or not document_id:
                print(f'Skipping: missing workflow_id or document_id')
                continue

            # Verify workflow exists (created by type-detection)
            workflow = get_workflow(document_id, workflow_id)
            if not workflow:
                print(f'Workflow not found: {workflow_id}, document: {document_id}')
                continue

            client = get_sfn_client()
            execution_name = f'{workflow_id[:16]}-{datetime.utcnow().strftime("%Y%m%d%H%M%S")}'

            # Input for Step Functions
            sfn_input = {
                'workflow_id': workflow_id,
                'document_id': document_id,
                'project_id': project_id,
                'file_uri': file_uri,
                'file_name': file_name,
                'file_type': file_type,
                'processing_type': processing_type,
                'language': language,
                'use_bda': use_bda,
                'triggered_at': datetime.utcnow().isoformat()
            }

            response = client.start_execution(
                stateMachineArn=STEP_FUNCTION_ARN,
                name=execution_name,
                input=json.dumps(sfn_input)
            )

            execution_arn = response['executionArn']

            # Update workflow with execution_arn and set status to in_progress
            update_workflow_status(
                document_id=document_id,
                workflow_id=workflow_id,
                status=WorkflowStatus.IN_PROGRESS,
                execution_arn=execution_arn
            )

            print(f'Started Step Functions for workflow {workflow_id}, execution: {execution_arn}')

            results.append({
                'workflow_id': workflow_id,
                'document_id': document_id,
                'project_id': project_id,
                'execution_arn': execution_arn,
                'status': 'started'
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
