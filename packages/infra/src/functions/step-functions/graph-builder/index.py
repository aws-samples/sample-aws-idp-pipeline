import json
import os
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

import yaml
from strands import Agent
from strands.models import BedrockModel

from shared.ddb_client import (
    record_step_start,
    record_step_error,
    record_step_skipped,
    get_project_language,
    get_document,
    StepName,
)
from shared.s3_analysis import get_all_segment_analyses, get_segment_analysis, get_s3_client, parse_s3_uri

import boto3

GRAPH_SERVICE_FUNCTION_NAME = os.environ.get('GRAPH_SERVICE_FUNCTION_NAME', '')
GRAPH_BUILDER_MODEL_ID = os.environ.get('GRAPH_BUILDER_MODEL_ID', '')
PROMPTS = None

lambda_client = None


def get_lambda_client():
    global lambda_client
    if lambda_client is None:
        from botocore.config import Config
        lambda_client = boto3.client(
            'lambda',
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
            config=Config(read_timeout=300),
        )
    return lambda_client


def get_prompts():
    global PROMPTS
    if PROMPTS is None:
        path = os.path.join(
            os.path.dirname(__file__), 'prompts', 'entity_extraction.yaml'
        )
        with open(path, 'r') as f:
            PROMPTS = yaml.safe_load(f)
    return PROMPTS


def invoke_graph_service(action: str, params: dict, max_retries: int = 3) -> dict:
    """Invoke the GraphService Lambda with retry on 5xx errors."""
    import time

    client = get_lambda_client()
    for attempt in range(max_retries + 1):
        response = client.invoke(
            FunctionName=GRAPH_SERVICE_FUNCTION_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps({'action': action, 'params': params}),
        )
        payload = json.loads(response['Payload'].read())
        if response.get('FunctionError') or payload.get('statusCode') != 200:
            error_msg = payload.get('error', 'Unknown')
            if attempt < max_retries and ('500' in str(error_msg) or '503' in str(error_msg)):
                wait = 2 ** attempt
                print(f'{action} retry {attempt + 1}/{max_retries} after {wait}s: {error_msg}')
                time.sleep(wait)
                continue
            raise RuntimeError(f'GraphService error: {error_msg}')
        return payload
    raise RuntimeError(f'GraphService error: max retries exceeded for {action}')


def send_batches_parallel(action: str, key: str, items: list, extra_params: dict,
                          batch_size: int = 50, max_workers: int = 2):
    """Send items to graph service in parallel batches with retry."""
    batches = []
    for i in range(0, len(items), batch_size):
        batches.append(items[i:i + batch_size])

    total = len(items)
    completed = 0
    errors = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}
        for batch in batches:
            params = {**extra_params, key: batch}
            future = executor.submit(invoke_graph_service, action, params)
            futures[future] = len(batch)

        for future in as_completed(futures):
            batch_len = futures[future]
            try:
                future.result()
                completed += batch_len
                if completed % 500 < batch_size or completed >= total:
                    print(f'{action}: {completed}/{total}')
            except Exception as e:
                errors.append(str(e))
                completed += batch_len
                print(f'{action} batch error: {e}')

    if errors:
        raise RuntimeError(f'{action}: {len(errors)} failed out of {len(batches)} batches')

    return completed


def create_analysis_nodes(segments, workflow_id, project_id, document_id):
    """Create Analysis nodes in Neptune for each QA pair across all segments."""
    analyses = []
    for seg in segments:
        segment_index = seg.get('segment_index', 0)
        for qa_index, analysis in enumerate(seg.get('ai_analysis', [])):
            analyses.append({
                'segment_index': segment_index,
                'qa_index': qa_index,
                'question': analysis.get('analysis_query', ''),
            })

    if analyses:
        send_batches_parallel(
            'add_analyses', 'analyses', analyses,
            {'project_id': project_id, 'workflow_id': workflow_id, 'document_id': document_id},
            batch_size=50,
        )

    return analyses


def deduplicate_entities(all_entities):
    """Deduplicate entities by normalized name."""
    seen = {}
    for ent in all_entities:
        key = ent["name"].lower().strip()
        if key in seen:
            existing = seen[key]
            for mention in ent.get('mentioned_in', []):
                existing.setdefault('mentioned_in', []).append(mention)
        else:
            seen[key] = ent
    return list(seen.values())


def collect_entities_from_segments(segments, workflow_id):
    """Collect pre-extracted entities and relationships from S3 segment data."""
    all_entities = []
    all_relationships = []

    for seg in segments:
        entities = seg.get('graph_entities', [])
        relationships = seg.get('graph_relationships', [])

        # Add workflow_id to mention references
        for ent in entities:
            for mention in ent.get('mentioned_in', []):
                mention['workflow_id'] = workflow_id

        all_entities.extend(entities)
        all_relationships.extend(relationships)

    return all_entities, all_relationships


def extract_entities_for_segment(segment_data, segment_index, language):
    """Fallback: extract entities via LLM for a single segment (used by qa-regenerator)."""
    if not GRAPH_BUILDER_MODEL_ID:
        return {'entities': [], 'relationships': []}

    prompts = get_prompts()
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
    bedrock_model = BedrockModel(model_id=GRAPH_BUILDER_MODEL_ID, region_name=region)
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


def handle_extract_entities(event):
    """Extract entities for a single segment and update Neptune graph.

    Called by qa-regenerator after adding/regenerating a QA pair.
    """
    project_id = event['project_id']
    workflow_id = event['workflow_id']
    file_uri = event['file_uri']
    segment_index = event['segment_index']
    language = event.get('language', 'English')

    segment_data = get_segment_analysis(file_uri, segment_index)
    if not segment_data:
        print(f'Segment not found: {file_uri}, index {segment_index}')
        return {'success': False, 'error': 'Segment not found'}

    result = extract_entities_for_segment(segment_data, segment_index, language)
    entities = result.get('entities', [])
    relationships = result.get('relationships', [])

    # Normalize mention references
    for ent in entities:
        normalized = []
        mentions = ent.get('mentioned_in') or ent.get('mentioned_in_segments') or []
        for mention in mentions:
            if isinstance(mention, int):
                mention = {'segment_index': mention, 'qa_index': 0}
            elif isinstance(mention, dict) and 'qa_index' not in mention:
                mention['qa_index'] = 0
            mention['workflow_id'] = workflow_id
            normalized.append(mention)
        ent['mentioned_in'] = normalized

    unique_entities = deduplicate_entities(entities)
    print(f'Extracted {len(unique_entities)} entities, {len(relationships)} relationships')

    if unique_entities:
        send_batches_parallel(
            'add_entities', 'entities', unique_entities,
            {'project_id': project_id},
        )

    return {
        'success': True,
        'entity_count': len(unique_entities),
        'relationship_count': 0,
    }


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    # Single-segment entity extraction mode (called by qa-regenerator)
    if event.get('mode') == 'extract_entities':
        return handle_extract_entities(event)

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id', '')
    project_id = event.get('project_id', 'default')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')
    segment_count = event.get('segment_count', 0)

    # If GraphService is not configured, skip this step
    if not GRAPH_SERVICE_FUNCTION_NAME:
        print('GraphService not configured, skipping graph builder')
        record_step_skipped(
            workflow_id, StepName.GRAPH_BUILDER, reason='GraphService not configured'
        )
        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_count': segment_count,
        }

    language = event.get('language') or get_project_language(project_id)

    record_step_start(workflow_id, StepName.GRAPH_BUILDER)

    try:
        # Resolve original file name from DynamoDB document record
        doc_record = get_document(project_id, document_id)
        display_name = (doc_record.get('name') if doc_record else None) or (file_uri.split('/')[-1] if file_uri else '')

        # 1. Create Document + Segment nodes + structural relationships (chunked)
        chunk_size = 500
        print(f'Creating segment links for {segment_count} segments ({chunk_size}/chunk)')
        for start in range(0, segment_count, chunk_size):
            end = min(start + chunk_size, segment_count)
            invoke_graph_service(
                'add_segment_links',
                {
                    'project_id': project_id,
                    'workflow_id': workflow_id,
                    'document_id': document_id,
                    'file_name': display_name,
                    'file_type': file_type,
                    'segment_count': segment_count,
                    'start_index': start,
                    'end_index': end,
                },
            )
            print(f'Segment links: {end}/{segment_count}')
        print('Segment links created')

        # 2. Load all segment analysis results from S3
        segments = get_all_segment_analyses(file_uri, segment_count)
        segments_sorted = sorted(segments, key=lambda x: x.get('segment_index', 0))
        print(f'Loaded {len(segments_sorted)} segments from S3')

        # 3. Build analyses list
        analyses = []
        for seg in segments_sorted:
            segment_index = seg.get('segment_index', 0)
            for qa_index, analysis in enumerate(seg.get('ai_analysis', [])):
                analyses.append({
                    'segment_index': segment_index,
                    'qa_index': qa_index,
                    'question': analysis.get('analysis_query', ''),
                })
        print(f'Analyses: {len(analyses)}')

        # 4. Collect and deduplicate entities
        all_entities, all_relationships = collect_entities_from_segments(
            segments_sorted, workflow_id
        )
        unique_entities = deduplicate_entities(all_entities)
        print(
            f'Entities: {len(all_entities)} -> {len(unique_entities)} unique, '
            f'Relationships: {len(all_relationships)}'
        )

        # 5. Save work items to S3 for Map processing
        bucket, s3_key = parse_s3_uri(file_uri)
        doc_prefix = '/'.join(s3_key.split('/')[:-1])  # e.g. projects/proj_X/documents/doc_X
        base_key = f'{doc_prefix}/graph_work'
        s3 = get_s3_client()

        graph_batches = []

        if analyses:
            key = f'{base_key}/analyses.json'
            s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(analyses), ContentType='application/json')
            graph_batches.append({
                'action': 'add_analyses',
                'item_key': 'analyses',
                's3_key': key,
                'batch_size': 50,
                'extra_params': {'project_id': project_id, 'workflow_id': workflow_id, 'document_id': document_id},
            })

        if unique_entities:
            key = f'{base_key}/entities.json'
            s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(unique_entities), ContentType='application/json')
            graph_batches.append({
                'action': 'add_entities',
                'item_key': 'entities',
                's3_key': key,
                'batch_size': 100,
                'extra_params': {'project_id': project_id},
            })

        # RELATES_TO relationships are no longer stored in the graph

        print(f'Saved {len(graph_batches)} work files to S3')

        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_count': segment_count,
            's3_bucket': bucket,
            'graph_batches': graph_batches,
            'entity_count': len(unique_entities),
            'relationship_count': len(all_relationships),
        }

    except Exception as e:
        print(f'Error in graph builder: {e}')
        traceback.print_exc()
        record_step_error(workflow_id, StepName.GRAPH_BUILDER, str(e))
        raise
