"""
PDF Format Parser

Supports:
- Digital PDF: Direct text extraction
- Scanned PDF: OCR (future)
"""
import os
import tempfile
from urllib.parse import urlparse
import boto3
import fitz

s3_client = None


def get_s3_client():
    global s3_client
    if s3_client is None:
        s3_client = boto3.client('s3')
    return s3_client


def parse_s3_uri(uri: str) -> tuple:
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip('/')
    return bucket, key


def download_file_from_s3(uri: str, local_path: str):
    client = get_s3_client()
    bucket, key = parse_s3_uri(uri)
    client.download_file(bucket, key, local_path)


def extract_text_from_pdf(pdf_path: str) -> list:
    """Extract text from each page of a PDF file."""
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
    Parse PDF document and extract text from each page.

    Args:
        event: Contains document_id, file_uri, segments

    Returns:
        Updated event with extracted text per segment
    """
    file_uri = event.get('file_uri')
    segments = event.get('segments', [])

    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        download_file_from_s3(file_uri, tmp_path)
        pdf_pages = extract_text_from_pdf(tmp_path)

        for segment in segments:
            segment_index = segment.get('segment_index', 0)
            if segment_index < len(pdf_pages):
                pdf_page = pdf_pages[segment_index]
                segment['parsed_text'] = pdf_page['text']
                segment['parsed_char_count'] = pdf_page['char_count']
            else:
                segment['parsed_text'] = ''
                segment['parsed_char_count'] = 0

        print(f'PDF: Extracted text from {len(pdf_pages)} pages')

        return {
            **event,
            'segments': segments,
            'parsed_page_count': len(pdf_pages)
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
