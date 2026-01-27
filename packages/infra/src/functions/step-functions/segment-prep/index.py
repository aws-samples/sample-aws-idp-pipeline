"""Segment Prep Lambda

Prepares segment metadata for downstream processing.

Supported formats:
- PDF: Render each page to PNG, create segment metadata
- Image: Use original file, create single segment metadata
- Video: Create single segment metadata (no image)

Output structure:
  s3://bucket/{base_path}/preprocessed/
    metadata.json - segment info
    page_0000.png - page images (for PDF)
"""
import json
import os
import tempfile
from urllib.parse import urlparse

import fitz  # PyMuPDF
from PIL import Image

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    update_workflow_total_segments,
    StepName,
)
from shared.s3_analysis import (
    get_s3_client,
    parse_s3_uri,
    save_segment_analysis,
    SegmentStatus,
)

# Image quality settings for PDF rendering
PDF_DPI = 150  # DPI for PDF page rendering

# Supported image extensions
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.tiff', '.tif', '.webp', '.bmp'}

# Supported video extensions
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}

# Supported audio extensions
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma'}


def get_file_extension(file_uri: str) -> str:
    """Get lowercase file extension from URI."""
    path = urlparse(file_uri).path
    ext_idx = path.rfind('.')
    if ext_idx == -1:
        return ''
    return path[ext_idx:].lower()


def get_document_base_path(file_uri: str) -> tuple[str, str]:
    """Extract bucket and document base path from file URI."""
    bucket, key = parse_s3_uri(file_uri)
    key_parts = key.split('/')

    # Find documents folder and include document_id
    if 'documents' in key_parts:
        doc_idx = key_parts.index('documents')
        base_path = '/'.join(key_parts[:doc_idx + 2])
    else:
        base_path = '/'.join(key_parts[:-1])

    return bucket, base_path


def download_file_from_s3(uri: str, local_path: str):
    """Download file from S3 to local path."""
    client = get_s3_client()
    bucket, key = parse_s3_uri(uri)
    client.download_file(bucket, key, local_path)


def upload_image_to_s3(bucket: str, key: str, image_bytes: bytes, content_type: str = 'image/png'):
    """Upload image bytes to S3."""
    client = get_s3_client()
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=image_bytes,
        ContentType=content_type
    )


def save_metadata_to_s3(bucket: str, base_path: str, metadata: dict):
    """Save preprocessor metadata to S3."""
    client = get_s3_client()
    key = f'{base_path}/preprocessed/metadata.json'
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(metadata, ensure_ascii=False, indent=2),
        ContentType='application/json'
    )
    return f's3://{bucket}/{key}'


def process_pdf(file_uri: str, bucket: str, base_path: str) -> list[dict]:
    """Process PDF file: render each page as PNG image."""
    segments = []

    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        download_file_from_s3(file_uri, tmp_path)
        doc = fitz.open(tmp_path)
        page_count = len(doc)
        print(f'PDF has {page_count} pages')

        for page_num in range(page_count):
            page = doc[page_num]

            # Render page to image at specified DPI
            mat = fitz.Matrix(PDF_DPI / 72, PDF_DPI / 72)  # 72 is default PDF DPI
            pix = page.get_pixmap(matrix=mat)

            # Convert to PNG bytes
            png_bytes = pix.tobytes('png')

            # Upload to S3
            image_key = f'{base_path}/preprocessed/page_{page_num:04d}.png'
            upload_image_to_s3(bucket, image_key, png_bytes)

            image_uri = f's3://{bucket}/{image_key}'
            segments.append({
                'segment_index': page_num,
                'segment_type': 'PAGE',
                'image_uri': image_uri,
                'width': pix.width,
                'height': pix.height
            })
            print(f'Rendered page {page_num} to {image_uri}')

        doc.close()
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return segments


def process_image(file_uri: str, bucket: str, base_path: str) -> list[dict]:
    """Process image file: use original file as single segment (no copy)."""
    ext = get_file_extension(file_uri)

    # Get image dimensions
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp_path = tmp.name

    try:
        download_file_from_s3(file_uri, tmp_path)
        with Image.open(tmp_path) as img:
            width, height = img.size
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    print(f'Using original image: {file_uri}')

    return [{
        'segment_index': 0,
        'segment_type': 'PAGE',
        'image_uri': file_uri,  # Use original file directly
        'width': width,
        'height': height
    }]


def process_video(file_uri: str) -> list[dict]:
    """Process video file: create single segment for entire video (no splitting)."""
    return [{
        'segment_index': 0,
        'segment_type': 'VIDEO',
        'file_uri': file_uri,
    }]


def process_audio(file_uri: str) -> list[dict]:
    """Process audio file: create single segment for entire audio (no splitting)."""
    return [{
        'segment_index': 0,
        'segment_type': 'AUDIO',
        'file_uri': file_uri,
    }]


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')

    record_step_start(workflow_id, StepName.SEGMENT_PREP)

    try:
        bucket, base_path = get_document_base_path(file_uri)
        ext = get_file_extension(file_uri)

        # Determine file type and process accordingly
        if file_type == 'application/pdf' or ext == '.pdf':
            print('Processing as PDF')
            segments = process_pdf(file_uri, bucket, base_path)
        elif ext in IMAGE_EXTENSIONS or file_type.startswith('image/'):
            print('Processing as image')
            segments = process_image(file_uri, bucket, base_path)
        elif ext in VIDEO_EXTENSIONS or file_type.startswith('video/'):
            print('Processing as video')
            segments = process_video(file_uri)
        elif ext in AUDIO_EXTENSIONS or file_type.startswith('audio/'):
            print('Processing as audio')
            segments = process_audio(file_uri)
        else:
            # Unknown type - treat as single segment
            print(f'Unknown file type: {file_type}, ext: {ext}. Treating as single segment.')
            segments = [{
                'segment_index': 0,
                'segment_type': 'UNKNOWN',
                'image_uri': '',
                'file_uri': file_uri
            }]

        # Save metadata (for internal use)
        metadata = {
            'segments': segments,
            'segment_count': len(segments),
            'file_uri': file_uri,
            'file_type': file_type
        }
        metadata_uri = save_metadata_to_s3(bucket, base_path, metadata)
        print(f'Saved metadata to {metadata_uri}')

        # Create initial segment analysis files (so frontend can show images immediately)
        for seg in segments:
            segment_type = seg.get('segment_type', 'PAGE')
            segment_data = {
                'segment_index': seg['segment_index'],
                'segment_type': segment_type,
                'image_uri': seg.get('image_uri', ''),
                'width': seg.get('width'),
                'height': seg.get('height'),
                'status': SegmentStatus.INDEXING,
                # Initialize empty fields for later merging
                'bda_indexer': '',
                'paddleocr': '',
                'paddleocr_blocks': None,
                'format_parser': '',
                'ai_analysis': [],
            }
            # Media-specific fields (video/audio)
            if segment_type in ('VIDEO', 'AUDIO'):
                segment_data['file_uri'] = seg.get('file_uri', file_uri)
                # Initialize transcribe fields for media files
                segment_data['transcribe'] = ''
                segment_data['transcribe_segments'] = []

            save_segment_analysis(file_uri, seg['segment_index'], segment_data)
            print(f'Created initial segment {seg["segment_index"]}')

        # Update workflow total_segments in DynamoDB
        document_id = event.get('document_id')
        update_workflow_total_segments(document_id, workflow_id, len(segments))

        record_step_complete(
            workflow_id,
            StepName.SEGMENT_PREP,
            segment_count=len(segments)
        )

        return {
            **event,
            'preprocessor_metadata_uri': metadata_uri,
            'segment_count': len(segments)
        }

    except Exception as e:
        error_msg = str(e)
        print(f'Error in segment-prep: {error_msg}')
        record_step_error(workflow_id, StepName.SEGMENT_PREP, error_msg)
        raise
