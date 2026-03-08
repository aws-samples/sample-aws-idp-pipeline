"""Graph Builder Finalizer Lambda

Called after SendGraphBatches Map completes.
Records graph builder step as complete in DynamoDB.
"""
import json

from shared.ddb_client import record_step_complete, StepName


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event['workflow_id']
    entity_count = event.get('entity_count', 0)
    relationship_count = event.get('relationship_count', 0)

    record_step_complete(
        workflow_id,
        StepName.GRAPH_BUILDER,
        entity_count=entity_count,
        relationship_count=relationship_count,
    )
    print(f'Finalized graph builder: {entity_count} entities, {relationship_count} relationships')

    return {
        'workflow_id': event.get('workflow_id'),
        'document_id': event.get('document_id'),
        'project_id': event.get('project_id'),
        'file_uri': event.get('file_uri'),
        'file_type': event.get('file_type'),
        'segment_count': event.get('segment_count'),
    }
