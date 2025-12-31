import json


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    document_id = event.get('document_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    processing_type = event.get('processing_type')
    segments = event.get('segments', [])
    bda_output_uri = event.get('bda_output_uri')

    segment_items = []
    for segment in segments:
        segment_items.append({
            'document_id': document_id,
            'segment_id': segment.get('segment_id'),
            'segment_index': segment.get('segment_index'),
            'file_uri': file_uri,
            'file_type': file_type,
            'processing_type': processing_type,
            'image_uri': segment.get('image_uri'),
            'bda_content': segment.get('bda_content', ''),
            'parsed_text': segment.get('parsed_text', ''),
            'bda_output_uri': bda_output_uri
        })

    print(f'Prepared {len(segment_items)} segments for parallel processing')

    return {
        'statusCode': 200,
        'document_id': document_id,
        'segment_ids': segment_items,
        'segment_count': len(segment_items)
    }
