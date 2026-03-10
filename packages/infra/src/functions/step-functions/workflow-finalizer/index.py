"""Workflow Finalizer Lambda

Called after PostAnalysisParallel (GraphBuilder + Summarizer) completes.
Records workflow as COMPLETED in DynamoDB.
"""
import json

from shared.ddb_client import (
    update_workflow_status,
    get_entity_prefix,
    WorkflowStatus,
)


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event['workflow_id']
    document_id = event.get('document_id', '')
    file_type = event.get('file_type', '')

    entity_type = get_entity_prefix(file_type)
    update_workflow_status(
        document_id,
        workflow_id,
        WorkflowStatus.COMPLETED,
        entity_type=entity_type,
    )

    print(f'Workflow {workflow_id} marked as COMPLETED')

    return {
        'workflow_id': workflow_id,
        'status': 'completed',
    }
