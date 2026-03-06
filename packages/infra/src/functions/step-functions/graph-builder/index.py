import hashlib
import json
import os
import traceback

import yaml
from strands import Agent
from strands.models import BedrockModel

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    record_step_skipped,
    get_project_language,
    get_document,
    StepName,
)
from shared.s3_analysis import get_all_segment_analyses

import boto3

GRAPH_SERVICE_FUNCTION_NAME = os.environ.get('GRAPH_SERVICE_FUNCTION_NAME', '')
ENTITY_BATCH_SIZE = 10
PROMPTS = None

lambda_client = None


def get_lambda_client():
    global lambda_client
    if lambda_client is None:
        lambda_client = boto3.client(
            'lambda',
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
        )
    return lambda_client


def entity_id(project_id: str, name: str, entity_type: str) -> str:
    """Generate a deterministic entity ID from project_id + name + type."""
    key = f'{project_id}:{name.lower().strip()}:{entity_type.lower()}'
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def get_prompts():
    global PROMPTS
    if PROMPTS is None:
        path = os.path.join(
            os.path.dirname(__file__), 'prompts', 'entity_extraction.yaml'
        )
        with open(path, 'r') as f:
            PROMPTS = yaml.safe_load(f)
    return PROMPTS


def invoke_graph_service(action: str, params: dict) -> dict:
    """Invoke the GraphService Lambda."""
    client = get_lambda_client()
    response = client.invoke(
        FunctionName=GRAPH_SERVICE_FUNCTION_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps({'action': action, 'params': params}),
    )
    payload = json.loads(response['Payload'].read())
    if response.get('FunctionError') or payload.get('statusCode') != 200:
        raise RuntimeError(f'GraphService error: {payload.get("error", "Unknown")}')
    return payload


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
        invoke_graph_service('add_analyses', {
            'project_id': project_id,
            'workflow_id': workflow_id,
            'document_id': document_id,
            'analyses': analyses,
        })
        print(f'Created {len(analyses)} analysis nodes')

    return analyses


def extract_entities_batch(
    model_id, region, language, segments_batch, existing_entities
):
    """Extract entities and relationships from a batch of segments using LLM."""
    prompts = get_prompts()

    # Format segments for prompt, including QA pair indices
    segments_text = ''
    for seg in segments_batch:
        idx = seg.get('segment_index', 0)
        for qa_idx, analysis in enumerate(seg.get('ai_analysis', [])):
            content = analysis.get('content', '')
            if content:
                segments_text += f'\n--- Segment {idx}, QA {qa_idx} ---\n{content}\n'
        page_desc = seg.get('page_description', '')
        if page_desc:
            segments_text += f'\n--- Segment {idx}, Page Description ---\n{page_desc}\n'

    if not segments_text.strip():
        return {'entities': [], 'relationships': []}

    # Format existing entities list
    existing_text = (
        'None'
        if not existing_entities
        else json.dumps(
            [{'name': e['name'], 'type': e['type']} for e in existing_entities],
            ensure_ascii=False,
        )
    )

    user_text = prompts['user'].format(
        language=language,
        existing_entities=existing_text,
        segments=segments_text,
    )

    bedrock_model = BedrockModel(model_id=model_id, region_name=region)
    agent = Agent(model=bedrock_model, system_prompt=prompts['system'])

    try:
        result = str(agent(user_text)).strip()
        # Parse JSON from response (handle potential markdown wrapping)
        if result.startswith('```'):
            result = result.split('```')[1]
            if result.startswith('json'):
                result = result[4:]
        return json.loads(result)
    except (json.JSONDecodeError, Exception) as e:
        print(f'Entity extraction parse error: {e}')
        return {'entities': [], 'relationships': []}


def deduplicate_entities(all_entities):
    """Deduplicate entities by normalized name + type."""
    seen = {}
    for ent in all_entities:
        key = f'{ent["name"].lower().strip()}:{ent["type"].lower()}'
        if key in seen:
            existing = seen[key]
            for mention in ent.get('mentioned_in', []):
                existing.setdefault('mentioned_in', []).append(mention)
        else:
            seen[key] = ent
    return list(seen.values())


def handle_extract_entities(event):
    """Extract entities for a single segment and update Neptune graph.

    Called by qa-regenerator after adding/regenerating a QA pair.
    """
    project_id = event['project_id']
    workflow_id = event['workflow_id']
    file_uri = event['file_uri']
    segment_index = event['segment_index']
    language = event.get('language', 'English')

    model_id = os.environ.get('GRAPH_BUILDER_MODEL_ID', '')
    region = os.environ.get('AWS_REGION', 'us-east-1')

    # Load the single segment from S3
    from shared.s3_analysis import get_segment_analysis
    segment_data = get_segment_analysis(file_uri, segment_index)
    if not segment_data:
        print(f'Segment not found: {file_uri}, index {segment_index}')
        return {'success': False, 'error': 'Segment not found'}

    segments_batch = [{
        'segment_index': segment_index,
        'ai_analysis': [
            {'content': a.get('content', ''), 'analysis_query': a.get('analysis_query', '')}
            for a in segment_data.get('ai_analysis', [])
        ],
        'page_description': segment_data.get('page_description', ''),
    }]

    # Extract entities
    result = extract_entities_batch(model_id, region, language, segments_batch, [])
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
        invoke_graph_service('add_entities', {
            'project_id': project_id,
            'entities': unique_entities,
        })

    if relationships:
        invoke_graph_service('add_relationships', {
            'project_id': project_id,
            'relationships': relationships,
        })

    return {
        'success': True,
        'entity_count': len(unique_entities),
        'relationship_count': len(relationships),
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

    model_id = os.environ.get('GRAPH_BUILDER_MODEL_ID', '')
    region = os.environ.get('AWS_REGION', 'us-east-1')
    language = event.get('language') or get_project_language(project_id)

    record_step_start(workflow_id, StepName.GRAPH_BUILDER)

    try:
        # Resolve original file name from DynamoDB document record
        doc_record = get_document(project_id, document_id)
        display_name = (doc_record.get('name') if doc_record else None) or (file_uri.split('/')[-1] if file_uri else '')

        # 1. Create Document + Segment nodes + structural relationships
        print(f'Creating segment links for {segment_count} segments')
        invoke_graph_service(
            'add_segment_links',
            {
                'project_id': project_id,
                'workflow_id': workflow_id,
                'document_id': document_id,
                'file_name': display_name,
                'file_type': file_type,
                'segment_count': segment_count,
            },
        )
        print('Segment links created')

        # 2. Load all segment analysis results from S3
        segments = get_all_segment_analyses(file_uri, segment_count)
        segments_sorted = sorted(segments, key=lambda x: x.get('segment_index', 0))
        print(f'Loaded {len(segments_sorted)} segments from S3')

        # 3. Create Analysis nodes for each QA pair
        analyses = create_analysis_nodes(
            segments_sorted, workflow_id, project_id, document_id
        )
        print(f'Analysis nodes: {len(analyses)}')

        # 4. Extract entities in batches
        all_entities = []
        all_relationships = []

        for batch_start in range(0, len(segments_sorted), ENTITY_BATCH_SIZE):
            batch = segments_sorted[batch_start : batch_start + ENTITY_BATCH_SIZE]
            batch_indices = [s.get('segment_index', 0) for s in batch]
            print(
                f'Extracting entities from segments {batch_indices[0]}-{batch_indices[-1]}'
            )

            result = extract_entities_batch(
                model_id,
                region,
                language,
                batch,
                all_entities,
            )

            batch_entities = result.get('entities', [])
            batch_relationships = result.get('relationships', [])

            # Normalize mention references: add workflow_id, handle qa_index
            for ent in batch_entities:
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

            all_entities.extend(batch_entities)
            all_relationships.extend(batch_relationships)

        # 5. Entity resolution (deduplicate)
        unique_entities = deduplicate_entities(all_entities)
        print(
            f'Entity resolution: {len(all_entities)} -> {len(unique_entities)} unique entities'
        )

        # 6. Add entities to graph
        if unique_entities:
            invoke_graph_service(
                'add_entities',
                {
                    'project_id': project_id,
                    'entities': unique_entities,
                },
            )
            print(f'Added {len(unique_entities)} entities to graph')

        # 7. Add relationships
        if all_relationships:
            invoke_graph_service(
                'add_relationships',
                {
                    'project_id': project_id,
                    'relationships': all_relationships,
                },
            )
            print(f'Added {len(all_relationships)} relationships to graph')

        record_step_complete(
            workflow_id,
            StepName.GRAPH_BUILDER,
            entity_count=len(unique_entities),
            relationship_count=len(all_relationships),
        )

        print(
            f'Graph builder completed: {len(unique_entities)} entities, '
            f'{len(all_relationships)} relationships'
        )

        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_count': segment_count,
        }

    except Exception as e:
        print(f'Error in graph builder: {e}')
        traceback.print_exc()
        record_step_error(workflow_id, StepName.GRAPH_BUILDER, str(e))
        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_count': segment_count,
        }
