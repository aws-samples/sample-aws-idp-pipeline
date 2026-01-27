import json
import os
from datetime import datetime, timezone

import boto3

from shared.s3_analysis import get_segment_analysis, update_segment_status, SegmentStatus

sqs_client = None
lambda_client = None
LANCEDB_WRITE_QUEUE_URL = os.environ.get('LANCEDB_WRITE_QUEUE_URL')
LANCEDB_FUNCTION_NAME = os.environ.get('LANCEDB_FUNCTION_NAME', 'idp-v2-lancedb-service')


def get_sqs_client():
    global sqs_client
    if sqs_client is None:
        sqs_client = boto3.client('sqs', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return sqs_client


def get_lambda_client():
    global lambda_client
    if lambda_client is None:
        lambda_client = boto3.client('lambda', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return lambda_client


def invoke_lancedb(action: str, params: dict) -> dict:
    """Invoke LanceDB service Lambda."""
    client = get_lambda_client()
    response = client.invoke(
        FunctionName=LANCEDB_FUNCTION_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps({'action': action, 'params': params})
    )

    payload = response['Payload'].read().decode('utf-8')

    if 'FunctionError' in response:
        print(f'LanceDB Lambda error: {response["FunctionError"]}, payload: {payload}')
        return {'statusCode': 500, 'error': f'Lambda error: {payload}'}

    result = json.loads(payload)
    return result


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    project_id = event.get('project_id', 'default')
    segment_index = event.get('segment_index', 0)
    file_uri = event.get('file_uri', '')
    file_type = event.get('file_type', '')
    is_reanalysis = event.get('is_reanalysis', False)

    if isinstance(segment_index, dict):
        segment_index = segment_index.get('segment_index', 0)

    # For re-analysis, delete existing LanceDB record first
    if is_reanalysis:
        print(f'Re-analysis mode: deleting existing record for segment {segment_index}')
        delete_result = invoke_lancedb('delete_record', {
            'project_id': project_id,
            'workflow_id': workflow_id,
            'segment_index': segment_index
        })
        print(f'Delete result: {delete_result}')

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

    transcribe_segments = segment_data.get('transcribe_segments', [])
    if transcribe_segments:
        segments_text = []
        for seg in transcribe_segments:
            start = seg.get('start_time', '')
            end = seg.get('end_time', '')
            transcript = seg.get('transcript', '')
            segments_text.append(f'[{start}s - {end}s] {transcript}')
        parts.append(f'## Transcribe Segments\n' + '\n'.join(segments_text))

    ai_analysis = segment_data.get('ai_analysis', [])
    for analysis in ai_analysis:
        query = analysis.get('analysis_query', '')
        content = analysis.get('content', '')
        if content:
            header = f'## AI Analysis: {query}' if query else '## AI Analysis'
            parts.append(f'{header}\n{content}')

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
