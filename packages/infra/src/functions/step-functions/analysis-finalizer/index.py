import json
import os
from datetime import datetime, timezone

import boto3

from shared.s3_analysis import get_segment_analysis, update_segment_status, SegmentStatus

sqs_client = None
LANCEDB_WRITE_QUEUE_URL = os.environ.get('LANCEDB_WRITE_QUEUE_URL')


def get_sqs_client():
    global sqs_client
    if sqs_client is None:
        sqs_client = boto3.client('sqs', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return sqs_client


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    project_id = event.get('project_id', 'default')
    segment_index = event.get('segment_index', 0)
    file_uri = event.get('file_uri', '')
    file_type = event.get('file_type', '')

    if isinstance(segment_index, dict):
        segment_index = segment_index.get('segment_index', 0)

    # Get segment data from S3
    segment_data = get_segment_analysis(file_uri, segment_index)

    if not segment_data:
        print(f'Segment not found in S3 for file {file_uri}, segment {segment_index}')
        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'not_found'
        }

    parts = []

    bda_indexer = segment_data.get('bda_indexer', '')
    if bda_indexer:
        parts.append(f'## BDA Indexer\n{bda_indexer}')

    paddleocr = segment_data.get('paddleocr', '')
    if paddleocr:
        parts.append(f'## PaddleOCR\n{paddleocr}')

    format_parser = segment_data.get('format_parser', '')
    if format_parser:
        parts.append(f'## Format Parser\n{format_parser}')

    image_analysis = segment_data.get('image_analysis', [])
    for analysis in image_analysis:
        content = analysis.get('content', '')
        if content:
            parts.append(f'## Image Analysis\n{content}')

    content_combined = '\n\n'.join(parts)

    image_uri = segment_data.get('image_uri', '')

    # Update status to FINALIZING
    update_segment_status(file_uri, segment_index, SegmentStatus.FINALIZING)

    message = {
        'workflow_id': workflow_id,
        'project_id': project_id,
        'segment_index': segment_index,
        'content_combined': content_combined,
        'file_uri': file_uri,
        'file_type': file_type,
        'image_uri': image_uri,
        'created_at': datetime.now(timezone.utc).isoformat()
    }

    try:
        client = get_sqs_client()
        response = client.send_message(
            QueueUrl=LANCEDB_WRITE_QUEUE_URL,
            MessageBody=json.dumps(message)
        )

        print(f'Sent segment {segment_index} to SQS, MessageId: {response["MessageId"]}')

        # Update status to COMPLETED
        update_segment_status(file_uri, segment_index, SegmentStatus.COMPLETED)

        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'queued',
            'content_length': len(content_combined),
            'sqs_message_id': response['MessageId']
        }

    except Exception as e:
        print(f'Error sending to SQS: {e}')
        # Update status to FAILED
        update_segment_status(file_uri, segment_index, SegmentStatus.FAILED, error=str(e))
        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'failed',
            'error': str(e)
        }
