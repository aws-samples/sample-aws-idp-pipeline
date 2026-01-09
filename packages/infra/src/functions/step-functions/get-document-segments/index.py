import json
import os

from shared.ddb_client import get_segment_count


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    segment_count = event.get('segment_count', 0)

    if segment_count == 0:
        segment_count = get_segment_count(workflow_id)

    segment_ids = list(range(segment_count))

    print(f'Prepared {len(segment_ids)} segment indices for parallel processing')

    return {
        'workflow_id': workflow_id,
        'project_id': event.get('project_id', 'default'),
        'file_uri': event.get('file_uri'),
        'file_type': event.get('file_type'),
        'segment_ids': segment_ids,
        'segment_count': segment_count
    }
