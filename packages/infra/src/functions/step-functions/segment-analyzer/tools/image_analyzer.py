import base64
import io
import json
import os
from typing import Callable

import boto3
import yaml
from PIL import Image
from strands import tool


def _load_image_analysis_prompt() -> str:
    prompt_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'prompts',
        'vision_react_agent.yaml'
    )
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompts = yaml.safe_load(f)
            return prompts.get('image_analysis_prompt', '')
    except Exception as e:
        print(f'Error loading image analysis prompt: {e}')
        return ''


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
            image_base64 = base64.b64encode(resized_image).decode('utf-8')

            previous_context = previous_context_getter()
            prompt_template = _load_image_analysis_prompt()

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
                                'media_type': 'image/png',
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
