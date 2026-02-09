"""Format Parser Lambda

Extracts text from documents (PDF, DOCX, Markdown, TXT, CSV).
- PDF: Uses pypdf with graphics stripping for efficiency
- DOCX: Uses python-docx for text extraction
- Markdown/TXT/CSV: Direct text reading

Text files are chunked (4000 chars, 200 overlap) for optimal processing.
Saves result to S3 as format-parser/result.json for segment-builder to merge.
"""
import json
import os
import re
import tempfile

import pypdf
from pypdf.generic import DecodedStreamObject, NameObject

# Text chunking configuration
TEXT_CHUNK_SIZE = 15000
TEXT_CHUNK_OVERLAP = 500

# File type constants
TEXT_MIME_TYPES = (
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
)

from shared.ddb_client import (
    update_workflow_status,
    get_entity_prefix,
        WorkflowStatus,
    record_step_start,
    record_step_complete,
    record_step_error,
    record_step_skipped,
    StepName,
)
from shared.s3_analysis import get_s3_client, parse_s3_uri

BT_ET_PATTERN = re.compile(rb'BT\b.*?ET\b', re.DOTALL)


def get_document_base_path(file_uri: str) -> tuple:
    """Extract bucket and document base path from file URI."""
    bucket, key = parse_s3_uri(file_uri)
    key_parts = key.split('/')

    if 'documents' in key_parts:
        doc_idx = key_parts.index('documents')
        base_path = '/'.join(key_parts[:doc_idx + 2])
    else:
        base_path = '/'.join(key_parts[:-1])

    return bucket, base_path


def strip_graphics_inplace(reader: pypdf.PdfReader):
    """Strip non-text content from PDF in-place, keeping only BT..ET text blocks."""
    for page in reader.pages:
        contents = page.get('/Contents')
        if contents is None:
            continue

        obj = contents.get_object()
        if isinstance(obj, pypdf.generic.ArrayObject):
            raw = b''.join(item.get_object().get_data() for item in obj)
            blocks = BT_ET_PATTERN.findall(raw)
            new_obj = DecodedStreamObject()
            new_obj.set_data(b'\n'.join(blocks))
            page[NameObject('/Contents')] = new_obj
        else:
            raw = obj.get_data()
            blocks = BT_ET_PATTERN.findall(raw)
            obj.set_data(b'\n'.join(blocks))


def process_pdf(file_uri: str) -> dict:
    """Download PDF, extract text per page, and save as result.json."""
    s3_client = get_s3_client()
    bucket, key = parse_s3_uri(file_uri)

    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name
        s3_client.download_file(bucket, key, tmp_path)

    file_size = os.path.getsize(tmp_path)
    print(f'[format-parser] Downloaded PDF: {file_size} bytes')

    try:
        with open(tmp_path, 'rb') as f:
            reader = pypdf.PdfReader(f)
            num_pages = len(reader.pages)
            print(f'[format-parser] PDF has {num_pages} pages')

            print(f'[format-parser] Stripping graphics from content streams...')
            strip_graphics_inplace(reader)

            pages = []
            total_chars = 0

            print(f'[format-parser] Extracting text...')
            for page_num, page in enumerate(reader.pages):
                text = (page.extract_text() or '').strip()
                pages.append({
                    'page_index': page_num,
                    'text': text,
                })
                total_chars += len(text)
                if (page_num + 1) % 500 == 0:
                    print(f'[format-parser] Extracted {page_num + 1}/{num_pages} pages')

        print(f'[format-parser] Done: {len(pages)} pages, {total_chars} chars')

        # Save to format-parser/result.json
        result_data = {'pages': pages}
        doc_bucket, base_path = get_document_base_path(file_uri)
        result_key = f'{base_path}/format-parser/result.json'

        s3_client.put_object(
            Bucket=doc_bucket,
            Key=result_key,
            Body=json.dumps(result_data, ensure_ascii=False),
            ContentType='application/json',
        )
        print(f'[format-parser] Saved result to s3://{doc_bucket}/{result_key}')

        return {
            'status': 'completed',
            'page_count': len(pages),
            'total_chars': total_chars,
        }

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def chunk_text(text: str, chunk_size: int = TEXT_CHUNK_SIZE, overlap: int = TEXT_CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks."""
    if not text:
        return []

    chunks = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = start + chunk_size

        # Try to break at sentence boundary
        if end < text_len:
            # Look for sentence end within last 200 chars
            search_start = max(start + chunk_size - 200, start)
            search_text = text[search_start:end]

            # Find last sentence boundary
            for sep in ['. ', '.\n', '? ', '?\n', '! ', '!\n', '\n\n']:
                last_sep = search_text.rfind(sep)
                if last_sep != -1:
                    end = search_start + last_sep + len(sep)
                    break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        # Move start with overlap
        start = end - overlap if end < text_len else text_len

    return chunks


def extract_docx_text(file_path: str) -> str:
    """Extract text from DOCX file using python-docx."""
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return '\n\n'.join(paragraphs)
    except ImportError:
        print('python-docx not installed, falling back to basic extraction')
        return ''
    except Exception as e:
        print(f'Error extracting DOCX text: {e}')
        return ''


def process_text_file(file_uri: str, file_type: str) -> dict:
    """Process text-based file (DOCX, Markdown, TXT, CSV) and save chunks."""
    s3_client = get_s3_client()
    bucket, key = parse_s3_uri(file_uri)

    # Determine file extension
    ext = '.' + key.split('.')[-1].lower() if '.' in key else '.txt'

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp_path = tmp.name
        s3_client.download_file(bucket, key, tmp_path)

    file_size = os.path.getsize(tmp_path)
    print(f'[format-parser] Downloaded text file: {file_size} bytes, type: {file_type}')

    try:
        # Extract text based on file type
        if file_type in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'):
            text = extract_docx_text(tmp_path)
            if not text:
                print('[format-parser] DOCX extraction failed or empty')
        else:
            # Plain text, markdown, csv - direct read
            with open(tmp_path, 'r', encoding='utf-8') as f:
                text = f.read()

        if not text:
            print('[format-parser] No text extracted')
            chunks_data = [{'chunk_index': 0, 'text': ''}]
        else:
            # Chunk the text
            chunks = chunk_text(text)
            print(f'[format-parser] Text split into {len(chunks)} chunks')
            chunks_data = [{'chunk_index': i, 'text': chunk} for i, chunk in enumerate(chunks)]

        total_chars = sum(len(c['text']) for c in chunks_data)
        print(f'[format-parser] Done: {len(chunks_data)} chunks, {total_chars} chars')

        # Save to format-parser/result.json
        result_data = {'chunks': chunks_data}
        doc_bucket, base_path = get_document_base_path(file_uri)
        result_key = f'{base_path}/format-parser/result.json'

        s3_client.put_object(
            Bucket=doc_bucket,
            Key=result_key,
            Body=json.dumps(result_data, ensure_ascii=False),
            ContentType='application/json',
        )
        print(f'[format-parser] Saved result to s3://{doc_bucket}/{result_key}')

        return {
            'status': 'completed',
            'chunk_count': len(chunks_data),
            'total_chars': total_chars,
        }

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def is_text_file(file_type: str) -> bool:
    """Check if file type is a text-based document."""
    return file_type in TEXT_MIME_TYPES


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')

    is_pdf = file_type == 'application/pdf'
    is_text = is_text_file(file_type)

    if not is_pdf and not is_text:
        print(f'Skipping unsupported file: {file_type}')
        record_step_skipped(workflow_id, StepName.FORMAT_PARSER, f'File type {file_type} is not supported')
        return {
            **event,
            'format_parser': {
                'status': 'skipped',
                'reason': f'File type {file_type} is not supported'
            }
        }

    try:
        record_step_start(workflow_id, StepName.FORMAT_PARSER)

        if is_pdf:
            result = process_pdf(file_uri=file_uri)
        else:
            result = process_text_file(file_uri=file_uri, file_type=file_type)

        print(f'Format parser completed: {result}')
        record_step_complete(workflow_id, StepName.FORMAT_PARSER)

        return {
            **event,
            'format_parser': result
        }

    except Exception as e:
        error_msg = str(e)
        print(f'Error in format parser: {error_msg}')
        import traceback
        traceback.print_exc()
        entity_type = get_entity_prefix(file_type)
        update_workflow_status(document_id, workflow_id, WorkflowStatus.FAILED, entity_type=entity_type, error=error_msg)
        record_step_error(workflow_id, StepName.FORMAT_PARSER, error_msg)

        return {
            **event,
            'format_parser': {
                'status': 'failed',
                'error': error_msg
            }
        }
