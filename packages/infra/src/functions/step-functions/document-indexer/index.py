import json
import os
import re
from urllib.parse import urlparse

import boto3

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    batch_save_segments,
    update_workflow_status,
    StepName,
)
from shared.websocket import notify_step_start, notify_step_complete, notify_step_error

s3_client = None


def get_s3_client():
    global s3_client
    if s3_client is None:
        s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return s3_client


def parse_s3_uri(uri: str) -> tuple:
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip('/')
    return bucket, key


def download_json_from_s3(uri: str) -> dict:
    client = get_s3_client()
    bucket, key = parse_s3_uri(uri)

    try:
        response = client.get_object(Bucket=bucket, Key=key)
        return json.loads(response['Body'].read().decode('utf-8'))
    except Exception as e:
        print(f'Error downloading {uri}: {e}')
        return {}


def extract_first_image_from_markdown(markdown: str, base_uri: str) -> str:
    pattern = r'!\[.*?\]\(\./([^)]+)\)'
    match = re.search(pattern, markdown)
    if match:
        image_filename = match.group(1)
        return f'{base_uri}/{image_filename}'
    return ''


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    processing_type = event.get('processing_type', 'document')
    bda_metadata_uri = event.get('bda_metadata_uri')
    bda_output_uri = event.get('bda_output_uri', '')

    record_step_start(workflow_id, StepName.DOCUMENT_INDEXER)
    notify_step_start(workflow_id, 'DocumentIndexer')

    segments = []

    if bda_metadata_uri:
        try:
            metadata = download_json_from_s3(bda_metadata_uri)
            print(f'BDA metadata keys: {list(metadata.keys())}')

            output_metadata = metadata.get('output_metadata', [])
            for output in output_metadata:
                segment_metadata = output.get('segment_metadata', [])
                for segment in segment_metadata:
                    standard_output_path = segment.get('standard_output_path')
                    if standard_output_path:
                        if standard_output_path.startswith('s3://'):
                            standard_output_uri = standard_output_path
                        else:
                            standard_output_uri = f'{bda_output_uri.rstrip("/")}/{standard_output_path}'
                        standard_output = download_json_from_s3(standard_output_uri)

                        pages = standard_output.get('pages', [])
                        for page in pages:
                            page_index = page.get('page_index', 0)
                            representation = page.get('representation', {})
                            markdown = representation.get('markdown', '')
                            asset_metadata = page.get('asset_metadata', {})
                            image_uri = asset_metadata.get('rectified_image', '')

                            if not image_uri and markdown:
                                image_uri = extract_first_image_from_markdown(
                                    markdown, bda_output_uri
                                )

                            segments.append({
                                'segment_index': page_index,
                                'bda_indexer': markdown,
                                'image_uri': image_uri,
                            })

        except Exception as e:
            print(f'Error processing BDA metadata: {e}')
            record_step_error(workflow_id, StepName.DOCUMENT_INDEXER, str(e))
            notify_step_error(workflow_id, 'DocumentIndexer', str(e))
            raise

    if not segments:
        segments.append({
            'segment_index': 0,
            'bda_indexer': '',
            'image_uri': '',
        })

    saved_count = batch_save_segments(workflow_id, segments)
    print(f'Saved {saved_count} segments to DynamoDB for workflow {workflow_id}')

    record_step_complete(
        workflow_id,
        StepName.DOCUMENT_INDEXER,
        segment_count=saved_count
    )
    notify_step_complete(
        workflow_id,
        'DocumentIndexer',
        segment_count=saved_count
    )

    update_workflow_status(workflow_id, 'indexing', total_segments=saved_count)

    return {
        'workflow_id': workflow_id,
        'project_id': event.get('project_id', 'default'),
        'file_uri': file_uri,
        'file_type': file_type,
        'processing_type': processing_type,
        'bda_output_uri': bda_output_uri,
        'segment_count': saved_count
    }
