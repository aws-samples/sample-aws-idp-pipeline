"""
Segment Builder Lambda

Merges all processing sources and creates segment JSON files for analysis.

Reads from:
- preprocessor/metadata.json - segment images from Preprocessor
- bda-output/ - BDA analysis results (if use_bda=true)
- paddleocr/result.json - OCR results
- format-parser/result.json - PDF text extraction results

Creates:
- analysis/segment_XXXX.json - merged segment data for SegmentAnalyzer
"""
import json
import re
from typing import Optional

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    update_workflow_status,
    get_project_language,
    WorkflowStatus,
    StepName,
)
from shared.s3_analysis import (
    save_segment_analysis,
    get_segment_analysis,
    get_s3_client,
    parse_s3_uri,
    SegmentStatus,
)


def download_json_from_s3(uri: str) -> Optional[dict]:
    """Download and parse JSON from S3. Returns None if not found."""
    client = get_s3_client()
    bucket, key = parse_s3_uri(uri)

    try:
        response = client.get_object(Bucket=bucket, Key=key)
        return json.loads(response['Body'].read().decode('utf-8'))
    except client.exceptions.NoSuchKey:
        print(f'File not found: {uri}')
        return None
    except Exception as e:
        print(f'Error downloading {uri}: {e}')
        return None


def get_document_base_path(file_uri: str) -> tuple[str, str]:
    """Extract bucket and document base path from file URI."""
    bucket, key = parse_s3_uri(file_uri)
    key_parts = key.split('/')

    if 'documents' in key_parts:
        doc_idx = key_parts.index('documents')
        base_path = '/'.join(key_parts[:doc_idx + 2])
    else:
        base_path = '/'.join(key_parts[:-1])

    return bucket, base_path


def transform_markdown_image_urls(markdown: str, base_uri: str) -> str:
    """Transform relative image paths in markdown to full S3 URIs."""
    if not markdown:
        return markdown

    def replace_image_url(match):
        alt_text = match.group(1)
        image_url = match.group(2)

        if image_url.startswith('s3://') or image_url.startswith('http'):
            return match.group(0)

        if image_url.startswith('./'):
            filename = image_url[2:]
            # Check if already has assets/ prefix
            if filename.startswith('assets/'):
                full_uri = f'{base_uri}/{filename}'
            else:
                full_uri = f'{base_uri}/assets/{filename}'
        elif image_url.startswith('assets/'):
            # Already has assets/ prefix
            full_uri = f'{base_uri}/{image_url}'
        else:
            full_uri = f'{base_uri}/assets/{image_url}'

        clean_alt = ' '.join(alt_text.split())
        clean_alt = clean_alt.replace('[', '\\[').replace(']', '\\]')
        return f'![{clean_alt}]({full_uri})'

    pattern = r'!\[(.*?)\]\(([^)]+)\)'
    return re.sub(pattern, replace_image_url, markdown, flags=re.DOTALL)


def parse_bda_output(bda_metadata_uri: str, bda_output_uri: str, is_video: bool) -> dict:
    """Parse BDA output and return indexed results by segment."""
    results = {}

    metadata = download_json_from_s3(bda_metadata_uri)
    if not metadata:
        return results

    output_metadata = metadata.get('output_metadata', [])
    for output in output_metadata:
        segment_metadata = output.get('segment_metadata', [])
        for segment in segment_metadata:
            standard_output_path = segment.get('standard_output_path')
            if not standard_output_path:
                continue

            if standard_output_path.startswith('s3://'):
                standard_output_uri = standard_output_path
            else:
                standard_output_uri = f'{bda_output_uri.rstrip("/")}/{standard_output_path}'

            standard_output = download_json_from_s3(standard_output_uri)
            if not standard_output:
                continue

            standard_output_base = standard_output_uri.rsplit('/', 1)[0]

            if is_video:
                # Video: extract chapters or single video segment
                video_data = standard_output.get('video', {})
                chapters = standard_output.get('chapters', []) or video_data.get('chapters', [])

                if not chapters:
                    video_summary = video_data.get('summary', '')
                    results[0] = {
                        'bda_indexer': video_summary,
                        'segment_type': 'VIDEO'
                    }
                else:
                    for idx, chapter in enumerate(chapters):
                        results[idx] = {
                            'bda_indexer': chapter.get('summary', ''),
                            'segment_type': 'CHAPTER',
                            'start_timecode_smpte': chapter.get('start_timecode_smpte', ''),
                            'end_timecode_smpte': chapter.get('end_timecode_smpte', '')
                        }
            else:
                # Document: extract pages
                pages = standard_output.get('pages', [])
                for page in pages:
                    page_index = page.get('page_index', 0)
                    representation = page.get('representation', {})
                    markdown = representation.get('markdown', '')

                    # Transform image URLs
                    transformed_markdown = transform_markdown_image_urls(
                        markdown, standard_output_base
                    )

                    # Get image URI (rectified_image is in /assets/ folder)
                    asset_metadata = page.get('asset_metadata', {})
                    image_uri = asset_metadata.get('rectified_image', '')
                    print(f'Page {page_index} rectified_image raw value: {image_uri}')
                    if image_uri and not image_uri.startswith('s3://'):
                        if image_uri.startswith('./'):
                            image_uri = f'{standard_output_base}/assets/{image_uri[2:]}'
                        elif image_uri.startswith('assets/'):
                            # Already has assets/ prefix
                            image_uri = f'{standard_output_base}/{image_uri}'
                        else:
                            image_uri = f'{standard_output_base}/assets/{image_uri}'
                    print(f'Page {page_index} rectified_image final: {image_uri}')

                    results[page_index] = {
                        'bda_indexer': transformed_markdown,
                        'bda_image_uri': image_uri,
                        'segment_type': 'PAGE'
                    }

    return results


def parse_ocr_result(file_uri: str) -> dict:
    """Read OCR result and return indexed by page."""
    bucket, base_path = get_document_base_path(file_uri)
    ocr_uri = f's3://{bucket}/{base_path}/paddleocr/result.json'

    result = download_json_from_s3(ocr_uri)
    if not result:
        return {}

    ocr_results = {}
    pages = result.get('pages', [])

    if not pages:
        # Single content (for single images)
        content = result.get('content', '')
        if content:
            ocr_results[0] = {
                'paddleocr': content,
                'paddleocr_blocks': {}
            }
        return ocr_results

    for i, page in enumerate(pages):
        page_content = page.get('content', '')
        page_blocks = page.get('blocks', [])
        page_width = page.get('width')
        page_height = page.get('height')

        ocr_results[i] = {
            'paddleocr': page_content,
            'paddleocr_blocks': {
                'blocks': page_blocks,
                'width': page_width,
                'height': page_height
            }
        }

    return ocr_results


def parse_format_parser_result(file_uri: str) -> dict:
    """Read format parser result and return indexed by page."""
    bucket, base_path = get_document_base_path(file_uri)
    parser_uri = f's3://{bucket}/{base_path}/format-parser/result.json'

    result = download_json_from_s3(parser_uri)
    if not result:
        return {}

    parser_results = {}
    pages = result.get('pages', [])

    for page in pages:
        page_index = page.get('page_index', 0)
        text = page.get('text', '')
        parser_results[page_index] = {
            'format_parser': text
        }

    return parser_results


def find_transcribe_result(file_uri: str) -> Optional[str]:
    """Find transcribe result JSON file from S3.

    Transcribe output is stored at: s3://bucket/.../transcribe/{workflow_id}-{timestamp}.json
    Returns the S3 URI of the transcribe result file, or None if not found.
    """
    client = get_s3_client()
    bucket, base_path = get_document_base_path(file_uri)
    prefix = f'{base_path}/transcribe/'

    try:
        paginator = client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                if key.endswith('.json'):
                    transcribe_uri = f's3://{bucket}/{key}'
                    print(f'Found transcribe result: {transcribe_uri}')
                    return transcribe_uri
    except Exception as e:
        print(f'Error finding transcribe result: {e}')

    return None


def parse_transcribe_result(file_uri: str) -> dict:
    """Read transcribe result and return transcript + audio_segments.

    Returns dict with:
    - transcribe: full transcript text
    - transcribe_segments: audio_segments array with timing info
    """
    transcribe_uri = find_transcribe_result(file_uri)
    if not transcribe_uri:
        return {}

    result = download_json_from_s3(transcribe_uri)
    if not result:
        return {}

    transcribe_data = {}

    # Extract full transcript from results.transcripts[0].transcript
    results = result.get('results', {})
    transcripts = results.get('transcripts', [])
    if transcripts:
        transcribe_data['transcribe'] = transcripts[0].get('transcript', '')

    # Extract audio_segments array (without items field)
    audio_segments = results.get('audio_segments', [])
    if audio_segments:
        # Filter out 'items' field from each segment
        filtered_segments = []
        for seg in audio_segments:
            filtered_seg = {
                'id': seg.get('id'),
                'transcript': seg.get('transcript', ''),
                'start_time': seg.get('start_time', ''),
                'end_time': seg.get('end_time', '')
            }
            filtered_segments.append(filtered_seg)
        transcribe_data['transcribe_segments'] = filtered_segments

    return transcribe_data


def parse_preprocessor_metadata(file_uri: str) -> list:
    """Read preprocessor metadata."""
    bucket, base_path = get_document_base_path(file_uri)
    metadata_uri = f's3://{bucket}/{base_path}/preprocessed/metadata.json'

    metadata = download_json_from_s3(metadata_uri)
    if not metadata:
        return []

    return metadata.get('segments', [])


def find_bda_output(file_uri: str) -> tuple[str, str]:
    """Find BDA output from S3 by scanning bda-output folder.

    Returns (bda_metadata_uri, bda_output_uri) or empty strings if not found.
    """
    client = get_s3_client()
    bucket, base_path = get_document_base_path(file_uri)
    prefix = f'{base_path}/bda-output/'

    try:
        # List objects to find job_metadata.json
        paginator = client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                if key.endswith('job_metadata.json'):
                    bda_metadata_uri = f's3://{bucket}/{key}'
                    # bda_output_uri is the parent directory
                    bda_output_uri = f's3://{bucket}/{key.rsplit("/", 1)[0]}'
                    print(f'Found BDA output: {bda_metadata_uri}')
                    return bda_metadata_uri, bda_output_uri
    except Exception as e:
        print(f'Error finding BDA output: {e}')

    return '', ''


def is_video_file(file_type: str) -> bool:
    """Check if file type is video."""
    if not file_type:
        return False
    file_type_lower = file_type.lower()
    if file_type_lower.startswith('video/'):
        return True
    video_extensions = ['mp4', 'mov', 'avi', 'mkv', 'webm']
    return file_type_lower in video_extensions


def is_audio_file(file_type: str) -> bool:
    """Check if file type is audio."""
    if not file_type:
        return False
    file_type_lower = file_type.lower()
    if file_type_lower.startswith('audio/'):
        return True
    audio_extensions = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma']
    return file_type_lower in audio_extensions


def is_media_file(file_type: str) -> bool:
    """Check if file type is video or audio (media that can be transcribed)."""
    return is_video_file(file_type) or is_audio_file(file_type)


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')
    use_bda = event.get('use_bda', False)
    bda_metadata_uri = event.get('bda_metadata_uri', '')
    bda_output_uri = event.get('bda_output_uri', '')

    record_step_start(workflow_id, StepName.SEGMENT_BUILDER)

    is_video = is_video_file(file_type)
    is_media = is_media_file(file_type)  # video or audio

    try:
        # 1. Read preprocessor metadata (always required)
        preprocessor_segments = parse_preprocessor_metadata(file_uri)
        if not preprocessor_segments:
            # Fallback: create single segment
            print('No preprocessor metadata, creating single segment')
            preprocessor_segments = [{
                'segment_index': 0,
                'segment_type': 'VIDEO' if is_video else 'PAGE',
                'image_uri': ''
            }]

        # 2. Read BDA results (if use_bda=true)
        bda_results = {}
        if use_bda:
            # Find BDA output from S3 if not provided in event
            if not bda_metadata_uri:
                bda_metadata_uri, bda_output_uri = find_bda_output(file_uri)

            if bda_metadata_uri:
                print('Reading BDA results...')
                bda_results = parse_bda_output(bda_metadata_uri, bda_output_uri, is_video)
                print(f'BDA: {len(bda_results)} segments')
            else:
                print('BDA output not found in S3')

        # 3. Read OCR results
        ocr_results = {}
        if not is_video:
            print('Reading OCR results...')
            ocr_results = parse_ocr_result(file_uri)
            print(f'OCR: {len(ocr_results)} pages')

        # 4. Read format parser results
        parser_results = {}
        if not is_video:
            print('Reading format parser results...')
            parser_results = parse_format_parser_result(file_uri)
            print(f'Parser: {len(parser_results)} pages')

        # 5. Read transcribe results (for video/audio)
        transcribe_data = {}
        if is_media:
            print('Reading transcribe results...')
            transcribe_data = parse_transcribe_result(file_uri)
            if transcribe_data:
                print(f'Transcribe: found transcript with {len(transcribe_data.get("transcribe_segments", []))} segments')
            else:
                print('Transcribe: no result found')

        # 5. Merge preprocessing results into existing segment files
        segment_count = len(preprocessor_segments)
        for seg in preprocessor_segments:
            i = seg['segment_index']

            # Read existing segment data (created by segment-prep)
            segment_data = get_segment_analysis(file_uri, i)
            if segment_data is None:
                # Fallback: create new if not exists
                segment_data = {
                    'segment_index': i,
                    'segment_type': seg.get('segment_type', 'PAGE'),
                    'image_uri': seg.get('image_uri', ''),
                    'ai_analysis': [],
                }
                # Media-specific fields (video/audio)
                if is_media:
                    segment_data['file_uri'] = seg.get('file_uri', file_uri)

            # Update status to ANALYZING
            segment_data['status'] = SegmentStatus.ANALYZING

            # Ensure media has file_uri
            if is_media and 'file_uri' not in segment_data:
                segment_data['file_uri'] = seg.get('file_uri', file_uri)

            # Merge BDA results (only when use_bda=true and BDA produced results)
            if use_bda and i in bda_results:
                bda_data = bda_results[i]
                segment_data['bda_indexer'] = bda_data.get('bda_indexer', '')
                # Override segment type from BDA if present
                if bda_data.get('segment_type'):
                    segment_data['segment_type'] = bda_data['segment_type']
            elif 'bda_indexer' not in segment_data:
                segment_data['bda_indexer'] = ''

            # Merge OCR results
            if i in ocr_results:
                ocr_data = ocr_results[i]
                segment_data['paddleocr'] = ocr_data.get('paddleocr', '')
                segment_data['paddleocr_blocks'] = ocr_data.get('paddleocr_blocks')
            elif 'paddleocr' not in segment_data:
                segment_data['paddleocr'] = ''
                segment_data['paddleocr_blocks'] = None

            # Merge format parser results
            if i in parser_results:
                parser_data = parser_results[i]
                segment_data['format_parser'] = parser_data.get('format_parser', '')
            elif 'format_parser' not in segment_data:
                segment_data['format_parser'] = ''

            # Merge transcribe results (for video/audio - applies to all segments)
            if is_media and transcribe_data:
                segment_data['transcribe'] = transcribe_data.get('transcribe', '')
                segment_data['transcribe_segments'] = transcribe_data.get('transcribe_segments', [])
            elif is_media:
                if 'transcribe' not in segment_data:
                    segment_data['transcribe'] = ''
                if 'transcribe_segments' not in segment_data:
                    segment_data['transcribe_segments'] = []

            # Save merged segment to S3
            save_segment_analysis(file_uri, i, segment_data)
            print(f'Merged segment {i}')

        record_step_complete(
            workflow_id,
            StepName.SEGMENT_BUILDER,
            segment_count=segment_count
        )

        print(f'Built {segment_count} segments')

        project_id = event.get('project_id', 'default')
        language = get_project_language(project_id)

        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_count': segment_count,
            'segment_ids': list(range(segment_count)),
            'language': language,
            'is_reanalysis': event.get('is_reanalysis', False)
        }

    except Exception as e:
        error_msg = str(e)
        print(f'Error building segments: {error_msg}')
        record_step_error(workflow_id, StepName.SEGMENT_BUILDER, error_msg)
        update_workflow_status(document_id, workflow_id, WorkflowStatus.FAILED, error=error_msg)
        raise
