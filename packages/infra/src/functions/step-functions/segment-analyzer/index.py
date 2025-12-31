import json
import os

from agent import VisionReactAgent


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    document_id = event.get('document_id')
    segment_id = event.get('segment_id')
    segment_index = event.get('segment_index', 0)
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    image_uri = event.get('image_uri')
    bda_content = event.get('bda_content', '')
    parsed_text = event.get('parsed_text', '')
    bda_output_uri = event.get('bda_output_uri')

    context_parts = []
    if bda_content:
        context_parts.append(f'## BDA Analysis:\n{bda_content}')
    if parsed_text:
        context_parts.append(f'## Parsed Text:\n{parsed_text}')

    context = '\n\n'.join(context_parts) if context_parts else 'No prior analysis available.'

    try:
        agent = VisionReactAgent(
            model_id=os.environ.get('BEDROCK_MODEL_ID', 'us.anthropic.claude-3-7-sonnet-20250219-v1:0'),
            region=os.environ.get('AWS_REGION', 'us-east-1')
        )

        result = agent.analyze(
            document_id=document_id,
            segment_id=segment_id,
            segment_index=segment_index,
            image_uri=image_uri,
            context=context,
            file_type=file_type
        )

        return {
            'statusCode': 200,
            'document_id': document_id,
            'segment_id': segment_id,
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'image_uri': image_uri,
            'bda_content': bda_content,
            'parsed_text': parsed_text,
            'analysis_result': result.get('response', ''),
            'analysis_steps': result.get('analysis_steps', []),
            'iterations': result.get('iterations', 0),
            'status': 'analyzed'
        }

    except Exception as e:
        print(f'Error in segment analysis: {e}')
        return {
            'statusCode': 500,
            'document_id': document_id,
            'segment_id': segment_id,
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'image_uri': image_uri,
            'bda_content': bda_content,
            'parsed_text': parsed_text,
            'analysis_result': '',
            'analysis_steps': [],
            'error': str(e),
            'status': 'failed'
        }
