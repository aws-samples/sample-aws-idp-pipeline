"""Format Parser Lambda

Extracts text from PDF documents using pypdf.
Strips non-text content (vector graphics) from content streams before extraction
to handle large/complex PDFs efficiently.
Saves result to S3 as format-parser/result.json for segment-builder to merge.
"""
import json
import os
import re
import tempfile

import pypdf
from pypdf.generic import DecodedStreamObject, NameObject

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


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')

    if file_type != 'application/pdf':
        print(f'Skipping non-PDF file: {file_type}')
        record_step_skipped(workflow_id, StepName.FORMAT_PARSER, f'File type {file_type} is not PDF')
        return {
            **event,
            'format_parser': {
                'status': 'skipped',
                'reason': f'File type {file_type} is not PDF'
            }
        }

    try:
        record_step_start(workflow_id, StepName.FORMAT_PARSER)

        result = process_pdf(file_uri=file_uri)

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
