import json
import os
from datetime import datetime, timezone

import boto3
import yaml
from strands import Agent
from strands.models import BedrockModel

from shared.s3_analysis import (
    get_segment_analysis,
    update_segment_analysis,
    update_segment_status,
    SegmentStatus,
)

sqs_client = None
lambda_client = None
LANCEDB_WRITE_QUEUE_URL = os.environ.get('LANCEDB_WRITE_QUEUE_URL')
LANCEDB_FUNCTION_NAME = os.environ.get('LANCEDB_FUNCTION_NAME', 'idp-v2-lance-service')
PAGE_DESCRIPTION_MODEL_ID = os.environ.get('PAGE_DESCRIPTION_MODEL_ID', '')
ENTITY_EXTRACTION_MODEL_ID = os.environ.get('ENTITY_EXTRACTION_MODEL_ID', '')
PROMPTS = None
ENTITY_PROMPTS = None


def get_sqs_client():
    global sqs_client
    if sqs_client is None:
        sqs_client = boto3.client('sqs', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return sqs_client


def get_lambda_client():
    global lambda_client
    if lambda_client is None:
        lambda_client = boto3.client('lambda', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return lambda_client


def get_prompts():
    global PROMPTS
    if PROMPTS is None:
        path = os.path.join(os.path.dirname(__file__), 'prompts', 'page_description.yaml')
        with open(path, 'r') as f:
            PROMPTS = yaml.safe_load(f)
    return PROMPTS


def get_entity_prompts():
    global ENTITY_PROMPTS
    if ENTITY_PROMPTS is None:
        path = os.path.join(os.path.dirname(__file__), 'prompts', 'entity_extraction.yaml')
        with open(path, 'r') as f:
            ENTITY_PROMPTS = yaml.safe_load(f)
    return ENTITY_PROMPTS


def invoke_lancedb(action: str, params: dict) -> dict:
    """Invoke LanceDB service Lambda."""
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

    result = json.loads(payload)
    return result


def build_page_content(segment_data: dict) -> str:
    """Build page content string from segment data."""
    parts = []

    bda_indexer = segment_data.get('bda_indexer', '')
    if bda_indexer:
        parts.append(f'[BDA]\n{bda_indexer}')

    format_parser = segment_data.get('format_parser', '')
    if format_parser:
        parts.append(f'[PDF Text]\n{format_parser}')

    webcrawler_content = segment_data.get('webcrawler_content', '')
    if webcrawler_content:
        parts.append(f'[Web]\n{webcrawler_content}')

    ai_analysis = segment_data.get('ai_analysis', [])
    for analysis in ai_analysis:
        query = analysis.get('analysis_query', '')
        content = analysis.get('content', '')
        if content:
            parts.append(f'[AI: {query}]\n{content}')

    return '\n\n'.join(parts)


def generate_page_description(segment_data: dict, page_number: int, language: str) -> str:
    """Generate page description using Haiku."""
    if not PAGE_DESCRIPTION_MODEL_ID:
        print('PAGE_DESCRIPTION_MODEL_ID not set, skipping description generation')
        return ''

    page_content = build_page_content(segment_data)
    if not page_content.strip():
        print(f'Page {page_number}: empty content, skipping description')
        return ''

    prompts = get_prompts()
    system_text = prompts['page_description_system'].format(language=language)
    user_text = prompts['page_description_user'].format(
        page_number=page_number,
        page_content=page_content
    )

    try:
        region = os.environ.get('AWS_REGION', 'us-east-1')
        model = BedrockModel(model_id=PAGE_DESCRIPTION_MODEL_ID, region_name=region)
        agent = Agent(model=model, system_prompt=system_text)
        result = agent(user_text)
        description = str(result).strip()
        print(f'Page {page_number}: generated description ({len(description)} chars)')
        return description
    except Exception as e:
        print(f'Page {page_number}: description generation failed: {e}')
        return ''


def build_qa_content(analysis_query: str, content: str) -> str:
    """Build content string for a single QA pair."""
    if analysis_query:
        return f'{analysis_query}\n{content}'
    return content


def extract_entities_from_segment(segment_data, segment_index, language):
    """Extract entities and relationships from a single segment using LLM."""
    if not ENTITY_EXTRACTION_MODEL_ID:
        return None

    prompts = get_entity_prompts()

    segments_text = ''
    for qa_idx, analysis in enumerate(segment_data.get('ai_analysis', [])):
        content = analysis.get('content', '')
        if content:
            segments_text += f'\n--- Segment {segment_index}, QA {qa_idx} ---\n{content}\n'
    page_desc = segment_data.get('page_description', '')
    if page_desc:
        segments_text += f'\n--- Segment {segment_index}, Page Description ---\n{page_desc}\n'

    if not segments_text.strip():
        return {'entities': [], 'relationships': []}

    system_prompt = prompts['system'].replace('{segment_index}', str(segment_index))
    user_text = prompts['user'].format(
        language=language,
        existing_entities='None',
        segments=segments_text,
        segment_index=segment_index,
    )

    region = os.environ.get('AWS_REGION', 'us-east-1')
    bedrock_model = BedrockModel(model_id=ENTITY_EXTRACTION_MODEL_ID, region_name=region)
    agent = Agent(model=bedrock_model, system_prompt=system_prompt)

    try:
        result = str(agent(user_text)).strip()
        if result.startswith('```'):
            result = result.split('```')[1]
            if result.startswith('json'):
                result = result[4:]
        parsed = json.loads(result)

        # Force all mentioned_in to use the correct segment_index
        for ent in parsed.get('entities', []):
            for mention in ent.get('mentioned_in', []):
                mention['segment_index'] = segment_index

        return parsed
    except (json.JSONDecodeError, Exception) as e:
        print(f'Entity extraction parse error: {e}')
        return {'entities': [], 'relationships': []}


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id', '')
    project_id = event.get('project_id', 'default')
    segment_index = event.get('segment_index', 0)
    file_uri = event.get('file_uri', '')
    file_type = event.get('file_type', '')
    language = event.get('language', 'en')
    is_reanalysis = event.get('is_reanalysis', False)

    if isinstance(segment_index, dict):
        segment_index = segment_index.get('segment_index', 0)

    # Get segment data from S3
    segment_data = get_segment_analysis(file_uri, segment_index)

    if not segment_data:
        print(f'Segment not found in S3 for file {file_uri}, segment {segment_index}')
        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'not_found'
        }

    # Generate page description using Haiku
    page_number = segment_index + 1
    page_description = generate_page_description(segment_data, page_number, language)

    # Save page_description to segment JSON
    if page_description:
        update_segment_analysis(file_uri, segment_index, page_description=page_description)
        print(f'Saved page_description to segment {segment_index}')

    # Extract entities and relationships for knowledge graph
    extraction_result = extract_entities_from_segment(segment_data, segment_index, language)
    if extraction_result:
        entities = extraction_result.get('entities', [])
        relationships = extraction_result.get('relationships', [])
        # Normalize mention references
        for ent in entities:
            normalized = []
            mentions = ent.get('mentioned_in') or ent.get('mentioned_in_segments') or []
            for mention in mentions:
                if isinstance(mention, int):
                    mention = {'segment_index': mention, 'qa_index': 0}
                elif isinstance(mention, dict) and 'qa_index' not in mention:
                    mention['qa_index'] = 0
                normalized.append(mention)
            ent['mentioned_in'] = normalized
        update_segment_analysis(
            file_uri, segment_index,
            graph_entities=entities,
            graph_relationships=relationships,
        )
        print(f'Extracted {len(entities)} entities, {len(relationships)} relationships for segment {segment_index}')

    image_uri = segment_data.get('image_uri', '')

    # Update status to FINALIZING
    update_segment_status(file_uri, segment_index, SegmentStatus.FINALIZING)

    # Send per-QA pair messages to SQS
    ai_analysis = segment_data.get('ai_analysis', [])
    created_at = datetime.now(timezone.utc).isoformat()
    sent_count = 0

    try:
        client = get_sqs_client()

        for qa_index, analysis in enumerate(ai_analysis):
            analysis_query = analysis.get('analysis_query', '')
            content = analysis.get('content', '')
            if not content:
                continue

            qa_content = build_qa_content(analysis_query, content)
            message = {
                'workflow_id': workflow_id,
                'document_id': document_id,
                'project_id': project_id,
                'segment_index': segment_index,
                'qa_index': qa_index,
                'question': analysis_query,
                'content_combined': qa_content,
                'file_uri': file_uri,
                'file_type': file_type,
                'image_uri': image_uri,
                'created_at': created_at
            }

            response = client.send_message(
                QueueUrl=LANCEDB_WRITE_QUEUE_URL,
                MessageBody=json.dumps(message)
            )
            sent_count += 1
            print(f'Sent segment {segment_index} QA {qa_index} to SQS, MessageId: {response["MessageId"]}')

        # Update status to COMPLETED
        update_segment_status(file_uri, segment_index, SegmentStatus.COMPLETED)

        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'queued',
            'qa_count': sent_count,
            'page_description_length': len(page_description),
        }

    except Exception as e:
        print(f'Error sending to SQS: {e}')
        # Update status to FAILED
        update_segment_status(file_uri, segment_index, SegmentStatus.FAILED, error=str(e))
        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'failed',
            'error': str(e)
        }
