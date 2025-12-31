import json
import os
from datetime import datetime, timezone

import boto3

sqs_client = None
LANCEDB_WRITE_QUEUE_URL = os.environ.get('LANCEDB_WRITE_QUEUE_URL')


def get_sqs_client():
    global sqs_client
    if sqs_client is None:
        sqs_client = boto3.client('sqs', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return sqs_client


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    document_id = event.get('document_id')
    segment_id = event.get('segment_id')
    segment_index = event.get('segment_index', 0)
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    image_uri = event.get('image_uri')
    bda_content = event.get('bda_content', '')
    pdf_text = event.get('pdf_text', '')
    analysis_result = event.get('analysis_result', '')
    analysis_steps = event.get('analysis_steps', [])

    content_parts = []
    tools = {
        'bda_indexer': [],
        'pdf_text_extractor': [],
        'image_analysis': []
    }

    if bda_content:
        content_parts.append(f'## BDA Analysis\n{bda_content}')
        tools['bda_indexer'].append({
            'content': bda_content,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    if pdf_text:
        content_parts.append(f'## PDF Text\n{pdf_text}')
        tools['pdf_text_extractor'].append({
            'content': pdf_text,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    if analysis_result:
        content_parts.append(f'## AI Analysis\n{analysis_result}')
        tools['image_analysis'].append({
            'content': analysis_result,
            'steps': analysis_steps,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    content_combined = '\n\n'.join(content_parts) if content_parts else ''

    # Prepare message for SQS
    message = {
        'document_id': document_id,
        'segment_id': segment_id,
        'segment_index': segment_index,
        'status': 'completed',
        'tools': tools,
        'content_combined': content_combined,
        'file_uri': file_uri,
        'file_type': file_type,
        'image_uri': image_uri
    }

    try:
        client = get_sqs_client()
        response = client.send_message(
            QueueUrl=LANCEDB_WRITE_QUEUE_URL,
            MessageBody=json.dumps(message)
        )

        print(f'Sent segment {segment_id} to SQS, MessageId: {response["MessageId"]}')

        return {
            'statusCode': 200,
            'document_id': document_id,
            'segment_id': segment_id,
            'segment_index': segment_index,
            'status': 'queued',
            'content_length': len(content_combined),
            'sqs_message_id': response['MessageId']
        }

    except Exception as e:
        print(f'Error sending to SQS: {e}')
        return {
            'statusCode': 500,
            'document_id': document_id,
            'segment_id': segment_id,
            'segment_index': segment_index,
            'status': 'failed',
            'error': str(e)
        }
