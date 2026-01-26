"""Check Preprocess Status Lambda

Called by Step Functions to check if all preprocessing tasks are complete.
Returns status information for the polling loop.
"""
import json

from shared.ddb_client import is_preprocess_complete


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')

    if not workflow_id or not document_id:
        return {
            **event,
            'preprocess_check': {
                'all_completed': False,
                'any_failed': True,
                'error': 'Missing workflow_id or document_id'
            }
        }

    result = is_preprocess_complete(document_id, workflow_id)

    print(f'Preprocess status for {workflow_id}: all_completed={result["all_completed"]}, any_failed={result["any_failed"]}')
    print(f'Status details: {json.dumps(result["status"])}')

    return {
        **event,
        'preprocess_check': result
    }
