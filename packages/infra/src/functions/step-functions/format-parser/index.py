"""Format Parser Lambda

Extracts text from PDF documents using pypdf.
Runs synchronously in Step Functions before waiting for async preprocessing.
"""
import json
import os
import tempfile

import boto3
import pypdf

from shared.ddb_client import (
    update_workflow_status,
    WorkflowStatus,
    record_step_start,
    record_step_complete,
    record_step_error,
    record_step_skipped,
    StepName,
)
from shared.s3_analysis import (
    get_s3_client,
    parse_s3_uri,
    update_segment_analysis,
    SegmentStatus,
)

BACKEND_TABLE_NAME = os.environ.get('BACKEND_TABLE_NAME', '')


def process_pdf(
    file_uri: str,
    workflow_id: str,
    document_id: str,
    project_id: str
) -> dict:
    """Download PDF and extract text page by page (streaming)."""
    s3_client = get_s3_client()
    bucket, key = parse_s3_uri(file_uri)

    # Download to temp file
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        tmp_path = tmp.name
        s3_client.download_file(bucket, key, tmp_path)

    try:
        page_count = 0
        total_chars = 0

        with open(tmp_path, 'rb') as f:
            reader = pypdf.PdfReader(f)
            for page_num, page in enumerate(reader.pages):
                text = (page.extract_text() or '').strip()
                update_segment_analysis(
                    file_uri=file_uri,
                    segment_index=page_num,
                    format_parser=text,
                    status=SegmentStatus.PARSING,
                )
                page_count += 1
                total_chars += len(text)

        return {
            'status': 'completed',
            'page_count': page_count,
            'total_chars': total_chars,
        }

    finally:
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
        record_step_skipped(workflow_id, StepName.FORMAT_PARSER, f'File type {file_type} is not PDF')
        return {
            **event,
            'format_parser': {
                'status': 'skipped',
                'reason': f'File type {file_type} is not PDF'
            }
        }

    try:
        # Update STEP record to in_progress
        record_step_start(workflow_id, StepName.FORMAT_PARSER)

        result = process_pdf(
            file_uri=file_uri,
            workflow_id=workflow_id,
            document_id=document_id,
            project_id=project_id
        )

        print(f'Format parser completed: {result}')

        # Update STEP record to completed
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
        update_workflow_status(document_id, workflow_id, WorkflowStatus.FAILED, error=error_msg)
        record_step_error(workflow_id, StepName.FORMAT_PARSER, error_msg)

        return {
            **event,
            'format_parser': {
                'status': 'failed',
                'error': error_msg
            }
        }
