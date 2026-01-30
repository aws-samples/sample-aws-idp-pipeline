import base64
import io
import json
import os
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlparse

import boto3
import yaml
from PIL import Image

from shared.s3_analysis import get_segment_analysis, save_segment_analysis

BEDROCK_MODEL_ID = os.environ['BEDROCK_MODEL_ID']
LANCEDB_FUNCTION_NAME = os.environ.get('LANCEDB_FUNCTION_NAME', 'idp-v2-lancedb-service')

s3_client = None
bedrock_client = None
lambda_client = None


def get_s3_client():
    global s3_client
    if s3_client is None:
        s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return s3_client


def get_bedrock_client():
    global bedrock_client
    if bedrock_client is None:
        bedrock_client = boto3.client('bedrock-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return bedrock_client


def get_lambda_client():
    global lambda_client
    if lambda_client is None:
        lambda_client = boto3.client('lambda', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return lambda_client


def _load_prompt() -> str:
    prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'regenerate.yaml')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompts = yaml.safe_load(f)
            return prompts.get('regenerate_prompt', '')
    except Exception as e:
        print(f'Error loading prompt: {e}')
        return ''


def _download_image(image_uri: str) -> bytes | None:
    if not image_uri:
        return None
    try:
        parsed = urlparse(image_uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip('/')
        client = get_s3_client()
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            client.download_file(bucket, key, tmp.name)
            with open(tmp.name, 'rb') as f:
                data = f.read()
            os.unlink(tmp.name)
            return data
    except Exception as e:
        print(f'Error downloading image: {e}')
        return None


def _resize_image_if_needed(image_data: bytes, max_size_mb: float = 3.5) -> bytes:
    try:
        max_bytes = int(max_size_mb * 1024 * 1024)
        if len(image_data) <= max_bytes:
            return image_data

        print(f'Image size {len(image_data) / (1024 * 1024):.2f}MB exceeds limit, resizing...')
        image = Image.open(io.BytesIO(image_data))
        original_size = image.size
        target_ratio = (max_bytes * 0.8 / len(image_data)) ** 0.5
        new_width = int(original_size[0] * target_ratio)
        new_height = int(original_size[1] * target_ratio)
        resized_image = image.resize((new_width, new_height), Image.LANCZOS)

        output_buffer = io.BytesIO()
        if image.mode in ('RGBA', 'LA'):
            resized_image.save(output_buffer, format='PNG', optimize=True)
        else:
            if resized_image.mode == 'RGBA':
                resized_image = resized_image.convert('RGB')
            resized_image.save(output_buffer, format='JPEG', quality=85, optimize=True)

        print(f'Resized: {original_size[0]}x{original_size[1]} -> {new_width}x{new_height}')
        return output_buffer.getvalue()
    except Exception as e:
        print(f'Image resize failed: {e}')
        return image_data


def _build_context(segment_data: dict) -> str:
    parts = []
    bda_indexer = segment_data.get('bda_indexer', '')
    if bda_indexer:
        parts.append(f'## BDA Indexer\n{bda_indexer}')

    paddleocr = segment_data.get('paddleocr', '')
    if paddleocr:
        parts.append(f'## PaddleOCR\n{paddleocr}')

    format_parser = segment_data.get('format_parser', '')
    if format_parser:
        parts.append(f'## Format Parser\n{format_parser}')

    transcribe_segments = segment_data.get('transcribe_segments', [])
    if transcribe_segments:
        segments_text = []
        for seg in transcribe_segments:
            start = seg.get('start_time', '')
            end = seg.get('end_time', '')
            transcript = seg.get('transcript', '')
            segments_text.append(f'[{start}s - {end}s] {transcript}')
        parts.append(f'## Transcribe Segments\n' + '\n'.join(segments_text))

    return '\n\n'.join(parts) if parts else 'No previous context available.'


def _build_previous_qa(ai_analysis: list, qa_index: int) -> str:
    if not ai_analysis:
        return 'No previous Q&A.'
    lines = []
    for i, item in enumerate(ai_analysis):
        if i == qa_index:
            continue
        query = item.get('analysis_query', '')
        content = item.get('content', '')
        lines.append(f'Q{i + 1}: {query}\nA{i + 1}: {content[:500]}')
    return '\n\n'.join(lines) if lines else 'No other Q&A items.'


def _build_content_combined(segment_data: dict) -> str:
    """Rebuild content_combined from segment data (same logic as analysis-finalizer)."""
    parts = []

    bda_indexer = segment_data.get('bda_indexer', '')
    if bda_indexer:
        parts.append(f'## BDA Indexer\n{bda_indexer}')

    paddleocr = segment_data.get('paddleocr', '')
    if paddleocr:
        parts.append(f'## PaddleOCR\n{paddleocr}')

    format_parser = segment_data.get('format_parser', '')
    if format_parser:
        parts.append(f'## Format Parser\n{format_parser}')

    transcribe_segments = segment_data.get('transcribe_segments', [])
    if transcribe_segments:
        segments_text = []
        for seg in transcribe_segments:
            start = seg.get('start_time', '')
            end = seg.get('end_time', '')
            transcript = seg.get('transcript', '')
            segments_text.append(f'[{start}s - {end}s] {transcript}')
        parts.append(f'## Transcribe Segments\n' + '\n'.join(segments_text))

    ai_analysis = segment_data.get('ai_analysis', [])
    for analysis in ai_analysis:
        query = analysis.get('analysis_query', '')
        content = analysis.get('content', '')
        if content:
            header = f'## AI Analysis: {query}' if query else '## AI Analysis'
            parts.append(f'{header}\n{content}')

    return '\n\n'.join(parts)


def invoke_lancedb(action: str, params: dict) -> dict:
    client = get_lambda_client()
    response = client.invoke(
        FunctionName=LANCEDB_FUNCTION_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps({'action': action, 'params': params})
    )
    payload = response['Payload'].read().decode('utf-8')
    if 'FunctionError' in response:
        print(f'LanceDB Lambda error: {response["FunctionError"]}, payload: {payload}')
        return {'statusCode': 500, 'error': f'Lambda error: {payload}'}
    return json.loads(payload)


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    file_uri = event.get('file_uri', '')
    segment_index = event.get('segment_index', 0)
    qa_index = event.get('qa_index', 0)
    question = event.get('question', '')
    user_instructions = event.get('user_instructions', '')
    language = event.get('language', 'English')
    workflow_id = event.get('workflow_id', '')
    document_id = event.get('document_id', '')
    project_id = event.get('project_id', 'default')
    file_type = event.get('file_type', '')
    mode = event.get('mode', 'regenerate')

    # 1. Load segment data from S3
    segment_data = get_segment_analysis(file_uri, segment_index)
    if not segment_data:
        return {'statusCode': 404, 'error': f'Segment not found: {file_uri}, index {segment_index}'}

    ai_analysis = segment_data.get('ai_analysis', [])
    if mode in ('regenerate', 'delete') and (qa_index < 0 or qa_index >= len(ai_analysis)):
        return {'statusCode': 400, 'error': f'Invalid qa_index: {qa_index}, total: {len(ai_analysis)}'}

    # Handle delete mode early - no Bedrock call needed
    if mode == 'delete':
        deleted_item = ai_analysis.pop(qa_index)
        segment_data['ai_analysis'] = ai_analysis
        save_segment_analysis(file_uri, segment_index, segment_data)

        # Rebuild content_combined and update LanceDB
        content_combined = _build_content_combined(segment_data)
        delete_result = invoke_lancedb('delete_record', {
            'project_id': project_id,
            'workflow_id': workflow_id,
            'segment_index': segment_index
        })
        print(f'LanceDB delete result: {delete_result}')

        add_result = invoke_lancedb('add_record', {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'segment_index': segment_index,
            'content_combined': content_combined,
            'file_uri': file_uri,
            'file_type': file_type,
            'image_uri': segment_data.get('image_uri', ''),
            'created_at': datetime.now(timezone.utc).isoformat()
        })
        print(f'LanceDB add result: {add_result}')

        return {
            'statusCode': 200,
            'deleted': True,
            'deleted_query': deleted_item.get('analysis_query', ''),
            'qa_index': qa_index
        }

    # 2. Build context and previous Q&A
    context = _build_context(segment_data)
    previous_qa = _build_previous_qa(ai_analysis, qa_index)

    # 3. Download and resize image
    image_uri = segment_data.get('image_uri', '')
    image_data = _download_image(image_uri)

    # 4. Build prompt
    prompt_template = _load_prompt()
    if prompt_template:
        prompt = prompt_template.format(
            previous_context=context,
            previous_qa=previous_qa,
            question=question,
            user_instructions=user_instructions or 'No additional instructions.',
            language=language
        )
    else:
        prompt = f'Answer this question about the document: {question}\n\nRespond in {language}.'

    # 5. Call Bedrock Claude vision API
    messages_content = []
    if image_data:
        resized = _resize_image_if_needed(image_data)
        image_base64 = base64.b64encode(resized).decode('utf-8')
        messages_content.append({
            'type': 'image',
            'source': {
                'type': 'base64',
                'media_type': 'image/png',
                'data': image_base64
            }
        })
    messages_content.append({'type': 'text', 'text': prompt})

    request_body = {
        'anthropic_version': 'bedrock-2023-05-31',
        'max_tokens': 8192,
        'temperature': 0.1,
        'messages': [{'role': 'user', 'content': messages_content}]
    }

    client = get_bedrock_client()
    response = client.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        body=json.dumps(request_body),
        contentType='application/json'
    )
    result = json.loads(response['body'].read().decode('utf-8'))
    answer = result.get('content', [{}])[0].get('text', '')

    # 6. Update ai_analysis in S3
    new_item = {
        'analysis_query': question,
        'content': answer[:3000]
    }
    if mode == 'add':
        ai_analysis.append(new_item)
        qa_index = len(ai_analysis) - 1
    else:
        ai_analysis[qa_index] = new_item
    segment_data['ai_analysis'] = ai_analysis
    save_segment_analysis(file_uri, segment_index, segment_data)

    # 7. Rebuild content_combined and update LanceDB
    content_combined = _build_content_combined(segment_data)

    # Delete existing record
    delete_result = invoke_lancedb('delete_record', {
        'project_id': project_id,
        'workflow_id': workflow_id,
        'segment_index': segment_index
    })
    print(f'LanceDB delete result: {delete_result}')

    # Add updated record
    add_result = invoke_lancedb('add_record', {
        'workflow_id': workflow_id,
        'document_id': document_id,
        'project_id': project_id,
        'segment_index': segment_index,
        'content_combined': content_combined,
        'file_uri': file_uri,
        'file_type': file_type,
        'image_uri': image_uri,
        'created_at': datetime.now(timezone.utc).isoformat()
    })
    print(f'LanceDB add result: {add_result}')

    return {
        'statusCode': 200,
        'analysis_query': question,
        'content': answer[:3000],
        'qa_index': qa_index
    }
