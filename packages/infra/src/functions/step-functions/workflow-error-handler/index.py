"""Workflow Error Handler Lambda

Centralized error handler for Step Functions workflow.
Updates workflow and document status to 'failed' in DynamoDB.
Called via addCatch on task states and from PreprocessFailed path.
"""
import json

from shared.ddb_client import (
    WorkflowStatus,
    record_step_error,
    update_workflow_status,
    get_entity_prefix,
    )


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id', '')
    document_id = event.get('document_id', '')
    project_id = event.get('project_id', '')
    file_uri = event.get('file_uri', '')
    file_type = event.get('file_type', '')

    # Error info injected by Step Functions addCatch (resultPath: $.error_info)
    error_info = event.get('error_info', {})
    error_type = error_info.get('Error', 'Unknown')
    error_cause = error_info.get('Cause', '')

    # For preprocess failure path, error_info may not exist
    preprocess_check = event.get('preprocess_check', {})
    if preprocess_check.get('any_failed'):
        error_type = 'PREPROCESS_FAILED'
        failed_processors = [
            k for k, v in preprocess_check.get('status', {}).items()
            if v.get('status') == 'failed'
        ]
        error_cause = f'Preprocessing failed: {", ".join(failed_processors)}' if failed_processors else 'Preprocessing failed'

    error_message = f'{error_type}: {error_cause}' if error_cause else error_type
    print(f'Handling error for workflow {workflow_id}: {error_message}')

    if not workflow_id or not document_id:
        print('Missing workflow_id or document_id, cannot update status')
        return {**event, 'error_handled': False}

    # Record step error if current_step is known
    current_step = event.get('current_step', '')
    if not current_step:
        # Try to figure out from preprocess_check
        preprocess_data = preprocess_check.get('data', {})
        current_step = preprocess_data.get('current_step', '')

    if current_step:
        try:
            record_step_error(workflow_id, current_step, error_message)
        except Exception as e:
            print(f'Failed to record step error: {e}')

    # Update workflow + document status to failed
    try:
        entity_type = get_entity_prefix(file_type)
        update_workflow_status(
            document_id,
            workflow_id,
            WorkflowStatus.FAILED,
            entity_type=entity_type,
            error=error_message,
        )
        print(f'Updated workflow {workflow_id} status to failed')
    except Exception as e:
        print(f'Failed to update workflow status: {e}')

    return {**event, 'error_handled': True, 'error_message': error_message}
