"""
PDF Format Parser

Supports:
- Digital PDF: Direct text extraction
- Scanned PDF: OCR (future)
"""
import tempfile

import fitz

from shared.ddb_client import get_segment_count
from shared.s3_analysis import update_segment_analysis, get_s3_client, parse_s3_uri


def download_file_from_s3(uri: str, local_path: str):
    client = get_s3_client()
    bucket, key = parse_s3_uri(uri)
    client.download_file(bucket, key, local_path)


def extract_text_from_pdf(pdf_path: str) -> list:
    pages = []
    doc = fitz.open(pdf_path)
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text()
        pages.append({
            'page_index': page_num,
            'text': text,
            'char_count': len(text)
        })
    doc.close()
    return pages


def parse(event: dict) -> dict:
    """
    Parse PDF document and update segments in S3 with extracted text.

    Args:
        event: Contains workflow_id, file_uri

    Returns:
        Updated event with parsing results
    """
    workflow_id = event.get('workflow_id')
    file_uri = event.get('file_uri')
    segment_count = event.get('segment_count', 0)

    if segment_count == 0:
        segment_count = get_segment_count(workflow_id)

    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        download_file_from_s3(file_uri, tmp_path)
        pdf_pages = extract_text_from_pdf(tmp_path)

        updated_count = 0
        for page_index, pdf_page in enumerate(pdf_pages):
            if page_index < segment_count:
                pdf_text = pdf_page['text']
                # Update segment in S3
                update_segment_analysis(file_uri, page_index, format_parser=pdf_text)
                updated_count += 1

        print(f'PDF: Updated {updated_count} segments in S3 with extracted text')

        return {
            **event,
            'parsed_page_count': len(pdf_pages),
            'updated_segment_count': updated_count
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
