"""Format Parser Lambda

Extracts text from PDF documents using pypdf.
Runs synchronously in Step Functions before waiting for async preprocessing.
"""
import json
import os
import tempfile

import boto3
import pypdf

from shared.ddb_client import save_segment, batch_save_segments
from shared.s3_analysis import get_s3_client, parse_s3_uri

BACKEND_TABLE_NAME = os.environ.get('BACKEND_TABLE_NAME', '')


def extract_pdf_text(file_path: str) -> list[dict]:
    """Extract text from PDF file, one entry per page."""
    pages = []

    with open(file_path, 'rb') as f:
        reader = pypdf.PdfReader(f)
        for page_num, page in enumerate(reader.pages):
            text = page.extract_text() or ''
            pages.append({
                'page': page_num,
                'text': text.strip()
            })

    return pages


def process_pdf(
    file_uri: str,
    workflow_id: str,
    document_id: str,
    project_id: str
) -> dict:
    """Download PDF and extract text from each page."""
    s3_client = get_s3_client()
    bucket, key = parse_s3_uri(file_uri)

    # Download to temp file
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name
        s3_client.download_file(bucket, key, tmp_path)

    try:
        # Extract text from PDF
        pages = extract_pdf_text(tmp_path)

        # Save extracted text to segments
        segments_to_save = []
        for page_data in pages:
            segment_data = {
                'segment_index': page_data['page'],
                'pdf_text': page_data['text'],
            }
            segments_to_save.append(segment_data)

        # Batch save segments with pdf_text
        if segments_to_save:
            batch_save_segments(
                document_id=document_id,
                workflow_id=workflow_id,
                segments=segments_to_save
            )

        return {
            'status': 'completed',
            'page_count': len(pages),
            'total_chars': sum(len(p['text']) for p in pages)
        }

    finally:
        # Cleanup temp file
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')
    project_id = event.get('project_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')

    # Only process PDF files
    if file_type != 'application/pdf':
        print(f'Skipping non-PDF file: {file_type}')
        return {
            **event,
            'format_parser': {
                'status': 'skipped',
                'reason': f'File type {file_type} is not PDF'
            }
        }

    try:
        result = process_pdf(
            file_uri=file_uri,
            workflow_id=workflow_id,
            document_id=document_id,
            project_id=project_id
        )

        print(f'Format parser completed: {result}')

        return {
            **event,
            'format_parser': result
        }

    except Exception as e:
        print(f'Error in format parser: {e}')
        import traceback
        traceback.print_exc()

        return {
            **event,
            'format_parser': {
                'status': 'failed',
                'error': str(e)
            }
        }
