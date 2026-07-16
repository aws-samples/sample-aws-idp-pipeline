"""Type Detection Lambda

Detects file type from S3 upload events and sends enriched message to Workflow Queue.
Preprocessing is orchestrated by Step Functions (not separate SQS consumers).
"""
import json
import os

import boto3

from shared.ddb_client import (
    generate_workflow_id,
    create_workflow,
    get_project_language,
    get_project_ocr_settings,
    get_project_document_prompt,
    get_document,
    PreprocessType,
)

sqs_client = None
autoscaling_client = None

WORKFLOW_QUEUE_URL = os.environ.get('WORKFLOW_QUEUE_URL', '')
SAGEMAKER_ENDPOINT_NAME = os.environ.get('SAGEMAKER_ENDPOINT_NAME', '')

# Models that run on Lambda (CPU-only) instead of SageMaker (GPU)
LAMBDA_OCR_MODELS = {'pp-ocrv5', 'pp-structurev3'}

# ISO 639-1 project language -> PaddleOCR language code
PROJECT_LANG_TO_OCR_LANG = {
    'ko': 'korean', 'ja': 'japan', 'zh': 'ch', 'zh-tw': 'chinese_cht',
    'en': 'en', 'fr': 'french', 'de': 'german', 'it': 'it', 'es': 'es',
    'pt': 'pt', 'ru': 'ru', 'ar': 'ar', 'hi': 'hi', 'vi': 'vi',
    'th': 'th', 'ms': 'ms', 'id': 'id', 'tr': 'tr', 'pl': 'pl', 'nl': 'nl',
    'sv': 'sv', 'no': 'no', 'da': 'da', 'fi': 'fi',
}

MIME_TYPE_MAP = {
    # Documents
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'csv': 'text/csv',
    'tsv': 'text/tab-separated-values',
    # Spreadsheets
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    # Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',
    'webp': 'image/webp',
    # Presentations
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'ppt': 'application/vnd.ms-powerpoint',
    # Videos
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    # Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    # Web Request
    'webreq': 'application/x-webreq',
    # CAD
    'dxf': 'application/dxf',
}

def get_sqs_client():
    global sqs_client
    if sqs_client is None:
        sqs_client = boto3.client(
            'sqs',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return sqs_client


def get_autoscaling_client():
    global autoscaling_client
    if autoscaling_client is None:
        autoscaling_client = boto3.client(
            'application-autoscaling',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return autoscaling_client


def trigger_sagemaker_scale_out():
    """Trigger immediate SageMaker scale-out by temporarily setting MinCapacity to 1."""
    if not SAGEMAKER_ENDPOINT_NAME:
        return

    try:
        client = get_autoscaling_client()
        resource_id = f'endpoint/{SAGEMAKER_ENDPOINT_NAME}/variant/AllTraffic'

        # Re-register scalable target with MinCapacity=1 to force scale-out
        client.register_scalable_target(
            ServiceNamespace='sagemaker',
            ResourceId=resource_id,
            ScalableDimension='sagemaker:variant:DesiredInstanceCount',
            MinCapacity=1,
            MaxCapacity=1,
        )
        print(f'Triggered SageMaker scale-out: {SAGEMAKER_ENDPOINT_NAME}')

        # Immediately restore MinCapacity to 0 (scaling policies will manage scale-in)
        client.register_scalable_target(
            ServiceNamespace='sagemaker',
            ResourceId=resource_id,
            ScalableDimension='sagemaker:variant:DesiredInstanceCount',
            MinCapacity=0,
            MaxCapacity=1,
        )
    except Exception as e:
        print(f'Failed to trigger SageMaker scale-out: {e}')


def get_mime_type(file_name: str) -> str:
    ext = file_name.lower().split('.')[-1]
    return MIME_TYPE_MAP.get(ext, 'application/octet-stream')


def get_processing_type(mime_type: str) -> str:
    if mime_type.startswith('image/'):
        return 'image'
    elif mime_type.startswith('video/'):
        return 'video'
    elif mime_type.startswith('audio/'):
        return 'audio'
    else:
        return 'document'


def extract_project_id(object_key: str) -> str:
    """Extract project_id from S3 object key.
    Expected format: projects/{project_id}/documents/{document_id}/{file_name}
    """
    parts = object_key.split('/')
    if len(parts) >= 2 and parts[0] == 'projects':
        return parts[1]
    return 'default'


def extract_document_id(object_key: str) -> str:
    """Extract document_id from S3 object key.
    Expected format: projects/{project_id}/documents/{document_id}/{file_name}
    """
    parts = object_key.split('/')
    try:
        doc_index = parts.index('documents')
        if doc_index + 1 < len(parts):
            return parts[doc_index + 1]
    except ValueError:
        pass
    return ''


def parse_eventbridge_s3_event(body: dict) -> dict | None:
    if body.get('detail-type') != 'Object Created':
        return None

    detail = body.get('detail', {})
    bucket_name = detail.get('bucket', {}).get('name')
    object_key = detail.get('object', {}).get('key')

    if not bucket_name or not object_key:
        return None

    file_name = object_key.split('/')[-1]
    project_id = extract_project_id(object_key)
    document_id = extract_document_id(object_key)

    return {
        'project_id': project_id,
        'document_id': document_id,
        'file_uri': f's3://{bucket_name}/{object_key}',
        'file_name': file_name,
        'file_type': get_mime_type(file_name),
    }


def send_to_queue(queue_url: str, message: dict) -> None:
    """Send message to SQS queue."""
    client = get_sqs_client()
    client.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(message)
    )


def send_to_workflow_queue(
    workflow_id: str,
    document_id: str,
    project_id: str,
    file_uri: str,
    file_name: str,
    file_type: str,
    language: str,
    use_bda: bool,
    use_ocr: bool = True,
    use_transcribe: bool = False,
    ocr_model: str = 'pp-ocrv5',
    ocr_options: dict | None = None,
    document_prompt: str = '',
    transcribe_options: dict | None = None,
    source_url: str = '',
    crawl_instruction: str = '',
) -> None:
    """Send enriched message to Workflow Queue. Step Functions handles all preprocessing."""
    is_webreq = file_type == 'application/x-webreq'
    is_text = file_type in ('text/plain', 'text/markdown')
    is_spreadsheet = file_type in (
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'text/tab-separated-values',
    )
    is_dxf = file_type in ('application/dxf', 'image/vnd.dxf')

    # Spreadsheets (xlsx/xls/csv) are treated as structured datasets: they take a
    # separate Step Functions branch (validate -> parquet -> reference doc ->
    # DATASET#) instead of the document analysis pipeline.
    if is_spreadsheet:
        processing_type = 'dataset'
    elif is_webreq:
        processing_type = 'web'
    elif is_text or is_dxf:
        processing_type = 'text'
    else:
        processing_type = get_processing_type(file_type)

    # Resolve OCR language option
    resolved_ocr_options = dict(ocr_options or {})
    if not resolved_ocr_options.get('lang') and language:
        ocr_lang = PROJECT_LANG_TO_OCR_LANG.get(language)
        if ocr_lang:
            resolved_ocr_options['lang'] = ocr_lang

    message = {
        'workflow_id': workflow_id,
        'document_id': document_id,
        'project_id': project_id,
        'file_uri': file_uri,
        'file_name': file_name,
        'file_type': file_type,
        'language': language,
        'processing_type': processing_type,
        'use_bda': use_bda,
        'use_ocr': use_ocr,
        'use_transcribe': use_transcribe,
        'ocr_model': ocr_model,
        'ocr_options': resolved_ocr_options,
        'document_prompt': document_prompt,
    }

    if transcribe_options:
        message['transcribe_options'] = transcribe_options
    if source_url:
        message['source_url'] = source_url
    if crawl_instruction:
        message['crawl_instruction'] = crawl_instruction

    send_to_queue(WORKFLOW_QUEUE_URL, message)
    print(f'Sent to Workflow queue: {workflow_id}')

    # Trigger SageMaker scale-out early for GPU OCR models
    if use_ocr and ocr_model not in LAMBDA_OCR_MODELS:
        trigger_sagemaker_scale_out()


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    results = []

    for record in event.get('Records', []):
        try:
            body = json.loads(record.get('body', '{}'))
            parsed = parse_eventbridge_s3_event(body)

            if not parsed:
                print(f"Skipping unsupported event: {body.get('detail-type')}")
                continue

            project_id = parsed['project_id']
            document_id = parsed['document_id']
            file_uri = parsed['file_uri']
            file_name = parsed['file_name']
            file_type = parsed['file_type']

            if not document_id:
                print('Skipping event: document_id not found in path')
                continue

            workflow_id = generate_workflow_id()

            # Get document settings
            document = get_document(project_id, document_id)

            # Resolve language: document override > project default
            language = (document.get('language') if document else None) or get_project_language(project_id)
            print(f'Project {project_id} language: {language}')

            use_bda = document.get('use_bda', False) if document else False
            use_ocr = document.get('use_ocr', True) if document else True
            use_transcribe = document.get('use_transcribe', False) if document else False

            # Resolve OCR settings: document override > project default
            project_ocr = get_project_ocr_settings(project_id)
            ocr_model = (document.get('ocr_model') if document else None) or project_ocr.get('ocr_model') or 'pp-ocrv5'
            ocr_options = (document.get('ocr_options') if document else None) or project_ocr.get('ocr_options') or {}
            print(f'Resolved OCR: enabled={use_ocr}, model={ocr_model}, options={ocr_options}')

            # Resolve transcribe options from document
            transcribe_options = (document.get('transcribe_options') if document else None) or None
            if transcribe_options:
                print(f'Transcribe options: {transcribe_options}')

            # Resolve document prompt: document override > project default
            doc_prompt = (document.get('document_prompt') if document else None)
            document_prompt = doc_prompt if doc_prompt is not None else get_project_document_prompt(project_id)

            # Parse .webreq file to extract source URL and instruction
            source_url = ''
            crawl_instruction = ''
            if file_type == 'application/x-webreq':
                try:
                    s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
                    parts = file_uri.replace('s3://', '').split('/', 1)
                    resp = s3.get_object(Bucket=parts[0], Key=parts[1])
                    webreq = json.loads(resp['Body'].read().decode('utf-8'))
                    source_url = webreq.get('url', '')
                    crawl_instruction = webreq.get('instruction', '')
                except Exception as e:
                    print(f'Failed to parse .webreq file: {e}')

            # Create workflow record with preprocess field
            # execution_arn will be empty initially, updated by Step Functions trigger
            create_workflow(
                workflow_id=workflow_id,
                document_id=document_id,
                project_id=project_id,
                file_uri=file_uri,
                file_name=file_name,
                file_type=file_type,
                execution_arn='',
                language=language,
                use_bda=use_bda,
                use_ocr=use_ocr,
                use_transcribe=use_transcribe,
                document_prompt=document_prompt,
                source_url=source_url,
                crawl_instruction=crawl_instruction,
            )
            print(f'Created workflow record: {workflow_id}')

            # Send enriched message to Workflow Queue
            send_to_workflow_queue(
                workflow_id=workflow_id,
                document_id=document_id,
                project_id=project_id,
                file_uri=file_uri,
                file_name=file_name,
                file_type=file_type,
                language=language,
                use_bda=use_bda,
                use_ocr=use_ocr,
                use_transcribe=use_transcribe,
                ocr_model=ocr_model,
                ocr_options=ocr_options,
                document_prompt=document_prompt,
                transcribe_options=transcribe_options,
                source_url=source_url,
                crawl_instruction=crawl_instruction,
            )

            results.append({
                'workflow_id': workflow_id,
                'document_id': document_id,
                'project_id': project_id,
                'file_type': file_type,
                'status': 'distributed'
            })

        except Exception as e:
            print(f'Error processing record: {e}')
            import traceback
            traceback.print_exc()
            results.append({
                'error': str(e),
                'status': 'failed'
            })

    return {
        'statusCode': 200,
        'body': json.dumps({
            'processed': len(results),
            'results': results
        })
    }
