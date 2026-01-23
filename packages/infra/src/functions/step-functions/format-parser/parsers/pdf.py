"""
PDF Format Parser

Extracts text from PDF documents using pypdf (BSD license).
Saves results to a separate file for SegmentBuilder to merge later.

Output: s3://bucket/{base_path}/format-parser/result.json
"""
import json
import os
import tempfile
from urllib.parse import urlparse

from pypdf import PdfReader

from shared.s3_analysis import get_s3_client, parse_s3_uri


def download_file_from_s3(uri: str, local_path: str):
    client = get_s3_client()
    bucket, key = parse_s3_uri(uri)
    client.download_file(bucket, key, local_path)


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


def extract_text_from_pdf(pdf_path: str) -> list[dict]:
    """Extract text from each page of PDF using pypdf."""
    pages = []
    reader = PdfReader(pdf_path)

    for page_num, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ''
        except Exception as e:
            print(f'Error extracting text from page {page_num}: {e}')
            text = ''

        pages.append({
            'page_index': page_num,
            'text': text,
            'char_count': len(text)
        })

    return pages


def save_result_to_s3(bucket: str, base_path: str, result: dict) -> str:
    """Save parser result to S3."""
    client = get_s3_client()
    key = f'{base_path}/format-parser/result.json'

    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(result, ensure_ascii=False, indent=2),
        ContentType='application/json'
    )

    return f's3://{bucket}/{key}'


def parse(event: dict) -> dict:
    """
    Parse PDF document and save extracted text to separate file.

    Args:
        event: Contains workflow_id, file_uri

    Returns:
        Updated event with parsing results
    """
    file_uri = event.get('file_uri')

    bucket, base_path = get_document_base_path(file_uri)

    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        download_file_from_s3(file_uri, tmp_path)
        pdf_pages = extract_text_from_pdf(tmp_path)

        # Save result to separate file
        result = {
            'pages': pdf_pages,
            'page_count': len(pdf_pages),
            'file_uri': file_uri
        }
        result_uri = save_result_to_s3(bucket, base_path, result)

        print(f'PDF: Extracted text from {len(pdf_pages)} pages, saved to {result_uri}')

        return {
            **event,
            'format_parser_result_uri': result_uri,
            'parsed_page_count': len(pdf_pages)
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
