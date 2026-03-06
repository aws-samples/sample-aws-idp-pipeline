import base64
import io
import json
import os
from typing import Callable

import boto3
from PIL import Image
from strands import tool

_s3_client = boto3.client('s3')
_prompt_cache = {}


def _load_prompt_from_s3(prompt_name: str) -> str:
    if prompt_name in _prompt_cache:
        return _prompt_cache[prompt_name]
    bucket = os.environ.get('AGENT_STORAGE_BUCKET_NAME', '')
    if not bucket:
        return ''
    s3_key = f'__prompts/analysis/{prompt_name}.txt'
    try:
        resp = _s3_client.get_object(Bucket=bucket, Key=s3_key)
        content = resp['Body'].read().decode('utf-8')
        _prompt_cache[prompt_name] = content
        return content
    except Exception as e:
        print(f'Failed to load prompt from S3 ({s3_key}): {e}')
        return ''


def _detect_media_type(image_data: bytes) -> str:
    """Detect image media type from bytes."""
    if image_data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if image_data[:2] == b'\xff\xd8':
        return 'image/jpeg'
    if image_data[:4] == b'GIF8':
        return 'image/gif'
    if image_data[:4] == b'RIFF' and image_data[8:12] == b'WEBP':
        return 'image/webp'
    return 'image/png'


def _resize_image_if_needed(image_data: bytes, max_size_mb: float = 3.5) -> bytes:
    """Resize image if it exceeds API limit."""
    try:
        current_size_mb = len(image_data) / (1024 * 1024)
        max_bytes = int(max_size_mb * 1024 * 1024)

        if len(image_data) <= max_bytes:
            return image_data

        print(f'Image size {current_size_mb:.2f}MB exceeds limit, resizing...')

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

        resized_data = output_buffer.getvalue()
        print(f'Resized: {original_size[0]}x{original_size[1]} -> {new_width}x{new_height}')

        return resized_data

    except Exception as e:
        print(f'Image resize failed: {e}')
        return image_data


def create_image_analyzer_tool(
    image_data_getter: Callable[[], bytes],
    previous_context_getter: Callable[[], str],
    analysis_steps: list,
    model_id: str,
    bedrock_client,
    language: str = 'English'
):
    """Create an image analyzer tool with context.

    Args:
        image_data_getter: Function to get current image data
        previous_context_getter: Function to get previous analysis context
        analysis_steps: List to append analysis steps
        model_id: Bedrock model ID
        bedrock_client: Bedrock client
        language: Language for analysis output (e.g., 'Korean', 'English')
    """

    @tool
    def analyze_image(question: str) -> str:
        """Analyze the document image with a specific question.

        Use this tool to examine specific aspects of the document image.
        Ask targeted questions about text content, visual elements, diagrams,
        tables, or any other details you need to understand.

        Args:
            question: The specific question to ask about the image content.
                      Be specific - e.g., "What are the dimensions shown in this drawing?"
                      or "Describe the table structure and its data."
        """
        image_data = image_data_getter()
        if image_data is None:
            return 'No image available for analysis.'

        try:
            resized_image = _resize_image_if_needed(image_data)
            media_type = _detect_media_type(resized_image)
            image_base64 = base64.b64encode(resized_image).decode('utf-8')

            previous_context = previous_context_getter()
            prompt_template = _load_prompt_from_s3('image_analysis_prompt')

            if prompt_template:
                analysis_prompt = prompt_template.format(
                    previous_context=previous_context or 'No previous analysis.',
                    query=question,
                    language=language
                )
            else:
                analysis_prompt = f"""Analyze this document image and answer the following question.

Previous Analysis Context:
{previous_context or 'No previous analysis.'}

Question: {question}

Provide detailed, professional analysis in {language}."""

            request_body = {
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 8192,
                'temperature': 0.1,
                'messages': [{
                    'role': 'user',
                    'content': [
                        {
                            'type': 'image',
                            'source': {
                                'type': 'base64',
                                'media_type': media_type,
                                'data': image_base64
                            },
                            'cache_control': {'type': 'ephemeral'}
                        },
                        {
                            'type': 'text',
                            'text': analysis_prompt
                        }
                    ]
                }]
            }

            response = bedrock_client.invoke_model(
                modelId=model_id,
                body=json.dumps(request_body),
                contentType='application/json'
            )

            result = json.loads(response['body'].read().decode('utf-8'))
            answer = result.get('content', [{}])[0].get('text', '')

            analysis_steps.append({
                'step': len(analysis_steps) + 1,
                'tool': 'analyze_image',
                'question': question,
                'answer': answer[:3000]
            })

            return answer

        except Exception as e:
            error_msg = f'Error analyzing image: {e}'
            print(error_msg)
            return error_msg

    return analyze_image
