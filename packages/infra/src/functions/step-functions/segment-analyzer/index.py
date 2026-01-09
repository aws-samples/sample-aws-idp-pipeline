import json
import os

from shared.ddb_client import (
    get_segment,
    add_image_analysis,
    record_step_start,
    StepName,
)
from shared.websocket import notify_segment_progress

from agent import VisionReactAgent

is_first_segment = {}


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    segment_index = event.get('segment_index', event)
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    segment_count = event.get('segment_count', 0)

    if isinstance(segment_index, dict):
        segment_index = segment_index.get('segment_index', 0)

    if workflow_id not in is_first_segment:
        is_first_segment[workflow_id] = True
        record_step_start(workflow_id, StepName.SEGMENT_ANALYZER)

    segment_data = get_segment(workflow_id, segment_index)

    if not segment_data:
        print(f'Segment {segment_index} not found for workflow {workflow_id}')
        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'not_found'
        }

    image_uri = segment_data.get('image_uri', '')
    bda_content = segment_data.get('bda_indexer', '')
    pdf_text = segment_data.get('format_parser', '')

    context_parts = []
    if bda_content:
        context_parts.append(f'## BDA Indexer:\n{bda_content}')
    if pdf_text:
        context_parts.append(f'## Format Parser:\n{pdf_text}')

    context = '\n\n'.join(context_parts) if context_parts else 'No prior analysis available.'

    try:
        agent = VisionReactAgent(
            model_id=os.environ.get('BEDROCK_MODEL_ID', 'us.anthropic.claude-3-7-sonnet-20250219-v1:0'),
            region=os.environ.get('AWS_REGION', 'us-east-1')
        )

        result = agent.analyze(
            document_id=workflow_id,
            segment_id=f'{workflow_id}_{segment_index:04d}',
            segment_index=segment_index,
            image_uri=image_uri,
            context=context,
            file_type=file_type
        )

        analysis_steps = result.get('analysis_steps', [])

        for step in analysis_steps:
            question = step.get('question', '')
            answer = step.get('answer', '')
            if question and answer:
                add_image_analysis(
                    workflow_id=workflow_id,
                    segment_index=segment_index,
                    analysis_query=question,
                    content=answer
                )

        if not analysis_steps:
            add_image_analysis(
                workflow_id=workflow_id,
                segment_index=segment_index,
                analysis_query=f'Page {segment_index + 1}',
                content=result.get('response', '')
            )

        if segment_count > 0:
            notify_segment_progress(workflow_id, segment_index + 1, segment_count)

        return {
            'workflow_id': workflow_id,
            'project_id': event.get('project_id', 'default'),
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'status': 'analyzed',
            'analysis_count': len(analysis_steps) if analysis_steps else 1
        }

    except Exception as e:
        print(f'Error in segment analysis: {e}')

        add_image_analysis(
            workflow_id=workflow_id,
            segment_index=segment_index,
            analysis_query='Analysis error',
            content=f'Analysis failed: {e}'
        )

        return {
            'workflow_id': workflow_id,
            'project_id': event.get('project_id', 'default'),
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'status': 'failed',
            'error': str(e)
        }
