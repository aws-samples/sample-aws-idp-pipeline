import json

from shared.s3_analysis import get_segment_count_from_s3


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    file_uri = event.get('file_uri')
    segment_count = event.get('segment_count', 0)

    if segment_count == 0:
        segment_count = get_segment_count_from_s3(file_uri)

    segment_ids = list(range(segment_count))

    print(f'Prepared {len(segment_ids)} segment indices for parallel processing')

    return {
        'workflow_id': event.get('workflow_id'),
        'document_id': event.get('document_id'),
        'project_id': event.get('project_id', 'default'),
        'file_uri': file_uri,
        'file_type': event.get('file_type'),
        'segment_ids': segment_ids,
        'segment_count': segment_count
    }
