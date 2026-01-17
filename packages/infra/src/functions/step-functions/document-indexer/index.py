import json
import os
import re

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    batch_save_segments,
    update_workflow_total_segments,
    StepName,
)
from shared.s3_analysis import (
    save_segment_analysis,
    get_analysis_s3_key,
    get_s3_client,
    parse_s3_uri,
)
from shared.websocket import notify_step_start, notify_step_complete, notify_step_error


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
    # Use DOTALL to handle multi-line alt text
    pattern = r'!\[.*?\]\(\./([^)]+)\)'
    match = re.search(pattern, markdown, re.DOTALL)
    if match:
        image_filename = match.group(1)
        return f'{base_uri}/assets/{image_filename}'
    return ''


def transform_markdown_image_urls(markdown: str, base_uri: str) -> str:
    """Transform relative image paths in markdown to full S3 URIs.

    BDA stores images in an 'assets/' subdirectory, but markdown references
    them as ./filename.png. This function adds the assets/ path.
    """
    if not markdown:
        return markdown

    def replace_image_url(match):
        alt_text = match.group(1)
        image_url = match.group(2)

        # Skip if already a full URI
        if image_url.startswith('s3://') or image_url.startswith('http'):
            return match.group(0)

        # Convert relative path to full S3 URI
        # BDA stores images in assets/ subdirectory
        if image_url.startswith('./'):
            filename = image_url[2:]
            full_uri = f'{base_uri}/assets/{filename}'
        else:
            full_uri = f'{base_uri}/assets/{image_url}'

        # Clean up alt text - remove newlines for cleaner output
        clean_alt = ' '.join(alt_text.split())
        # Escape brackets in alt text to prevent markdown parsing issues
        clean_alt = clean_alt.replace('[', '\\[').replace(']', '\\]')
        return f'![{clean_alt}]({full_uri})'

    # Match markdown image syntax: ![alt](url)
    # Use non-greedy match with DOTALL to handle multi-line alt text and nested brackets
    pattern = r'!\[(.*?)\]\(([^)]+)\)'
    return re.sub(pattern, replace_image_url, markdown, re.DOTALL)


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
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

                        # Get base directory of standard_output.json for relative image paths
                        standard_output_base = standard_output_uri.rsplit('/', 1)[0]

                        pages = standard_output.get('pages', [])
                        for page in pages:
                            page_index = page.get('page_index', 0)
                            representation = page.get('representation', {})
                            markdown = representation.get('markdown', '')
                            asset_metadata = page.get('asset_metadata', {})
                            image_uri = asset_metadata.get('rectified_image', '')

                            # Handle relative path in rectified_image
                            # BDA stores images in assets/ subdirectory
                            if image_uri and not image_uri.startswith('s3://'):
                                if image_uri.startswith('./'):
                                    image_uri = f'{standard_output_base}/assets/{image_uri[2:]}'
                                else:
                                    image_uri = f'{standard_output_base}/assets/{image_uri}'

                            if not image_uri and markdown:
                                image_uri = extract_first_image_from_markdown(
                                    markdown, standard_output_base
                                )

                            # Transform relative image paths in markdown to full S3 URIs
                            transformed_markdown = transform_markdown_image_urls(
                                markdown, standard_output_base
                            )

                            segments.append({
                                'segment_index': page_index,
                                'bda_indexer': transformed_markdown,
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

    # Save segment data to S3 and collect references for DDB
    ddb_segments = []
    for seg in segments:
        segment_index = seg['segment_index']
        segment_data = {
            'segment_index': segment_index,
            'image_uri': seg.get('image_uri', ''),
            'bda_indexer': seg.get('bda_indexer', ''),
            'format_parser': '',
            'image_analysis': []
        }

        # Save to S3
        s3_key = save_segment_analysis(file_uri, segment_index, segment_data)

        # Prepare DDB reference
        ddb_segments.append({
            'segment_index': segment_index,
            's3_key': s3_key,
            'image_uri': seg.get('image_uri', '')
        })

    saved_count = batch_save_segments(workflow_id, ddb_segments)
    print(f'Saved {saved_count} segments to S3 and DynamoDB for workflow {workflow_id}')

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

    update_workflow_total_segments(document_id, workflow_id, saved_count)

    return {
        **event,
        'segment_count': saved_count
    }
