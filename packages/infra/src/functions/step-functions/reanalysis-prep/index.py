"""
Reanalysis Preparation Lambda

Prepares existing segments for re-analysis:
1. Deletes existing LanceDB records for the workflow
2. Counts existing segment files from S3
3. Clears ai_analysis from each segment
4. Saves reanalysis_instructions to each segment
5. Returns segment_ids for Map processing
"""
import json
import os

import boto3

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    update_workflow_status,
    get_entity_prefix,
    get_steps,
    get_table,
    StepName,
    WorkflowStatus,
)
from shared.s3_analysis import (
    get_segment_count_from_s3,
    clear_segment_ai_analysis,
    save_reanalysis_instructions,
)

LANCEDB_FUNCTION_NAME = os.environ.get('LANCEDB_FUNCTION_NAME', 'idp-v2-lance-service')
GRAPH_SERVICE_FUNCTION_NAME = os.environ.get('GRAPH_SERVICE_FUNCTION_NAME', '')

_lambda_client = None


def get_lambda_client():
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client('lambda')
    return _lambda_client


def invoke_lambda(function_name: str, payload: dict) -> dict:
    """Invoke a Lambda function synchronously."""
    client = get_lambda_client()
    response = client.invoke(
        FunctionName=function_name,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload)
    )
    return json.loads(response['Payload'].read().decode('utf-8'))


def delete_lancedb_records(project_id: str, workflow_id: str):
    """Delete all LanceDB records for a workflow."""
    return invoke_lambda(LANCEDB_FUNCTION_NAME, {
        'action': 'delete_record',
        'params': {
            'project_id': project_id,
            'workflow_id': workflow_id,
        }
    })


def delete_graph_data(project_id: str, workflow_id: str):
    """Delete all graph data for a workflow."""
    if not GRAPH_SERVICE_FUNCTION_NAME:
        return {'skipped': True}
    return invoke_lambda(GRAPH_SERVICE_FUNCTION_NAME, {
        'action': 'delete_by_workflow',
        'params': {
            'project_id': project_id,
            'workflow_id': workflow_id,
        }
    })


def _reset_analysis_steps(workflow_id: str):
    """Reset analysis-related steps to pending for re-analysis."""
    steps = get_steps(workflow_id)
    if not steps:
        return

    table = get_table()
    data = steps.get('data', {})

    for step_name in [
        StepName.SEGMENT_BUILDER,
        StepName.SEGMENT_ANALYZER,
        StepName.GRAPH_BUILDER,
        StepName.DOCUMENT_SUMMARIZER,
    ]:
        if step_name in data:
            data[step_name]['status'] = 'pending'
            data[step_name].pop('started_at', None)
            data[step_name].pop('ended_at', None)
            data[step_name].pop('error', None)

    table.update_item(
        Key={'PK': f'WF#{workflow_id}', 'SK': 'STEP'},
        UpdateExpression='SET #data = :data',
        ExpressionAttributeNames={'#data': 'data'},
        ExpressionAttributeValues={':data': data},
    )
    print(f'Reset analysis steps to pending for workflow {workflow_id}')


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')
    project_id = event.get('project_id', 'default')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')
    language = event.get('language', '')
    user_instructions = event.get('user_instructions', '')

    # Reset analysis steps to pending for progress display
    _reset_analysis_steps(workflow_id)

    # Update language in workflow data if provided
    if language:
        entity_type = get_entity_prefix(file_type)
        update_workflow_status(
            document_id, workflow_id, WorkflowStatus.IN_PROGRESS,
            entity_type=entity_type, language=language,
        )

    record_step_start(workflow_id, StepName.SEGMENT_BUILDER)

    try:
        # Delete existing data for this workflow
        print(f'Deleting LanceDB records for workflow {workflow_id}')
        delete_result = delete_lancedb_records(project_id, workflow_id)
        print(f'LanceDB delete result: {delete_result}')

        print(f'Deleting graph data for workflow {workflow_id}')
        graph_result = delete_graph_data(project_id, workflow_id)
        print(f'Graph delete result: {graph_result}')

        # Get segment count from existing S3 files
        segment_count = get_segment_count_from_s3(file_uri)
        print(f'Found {segment_count} existing segments')

        if segment_count == 0:
            raise ValueError(f'No segments found for file: {file_uri}')

        # Prepare each segment for re-analysis
        for i in range(segment_count):
            # Clear existing ai_analysis
            clear_segment_ai_analysis(file_uri, i)

            # Save reanalysis instructions if provided
            if user_instructions:
                save_reanalysis_instructions(file_uri, i, user_instructions)

            print(f'Prepared segment {i} for re-analysis')

        record_step_complete(
            workflow_id,
            StepName.SEGMENT_BUILDER,
            segment_count=segment_count
        )

        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_ids': list(range(segment_count)),
            'segment_count': segment_count,
            'is_reanalysis': True,
            'language': event.get('language', ''),
            'document_prompt': event.get('document_prompt', ''),
        }

    except Exception as e:
        error_msg = str(e)
        print(f'Error in reanalysis-prep: {error_msg}')
        record_step_error(workflow_id, StepName.SEGMENT_BUILDER, error_msg)
        entity_type = get_entity_prefix(file_type)
        update_workflow_status(document_id, workflow_id, WorkflowStatus.FAILED, entity_type=entity_type, error=error_msg)
        raise
