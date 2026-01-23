import json
import os

from shared.ddb_client import (
    record_step_start,
    get_project_language,
    get_project_document_prompt,
    StepName,
)
from shared.s3_analysis import (
    get_segment_analysis,
    add_segment_ai_analysis,
    update_segment_status,
    SegmentStatus,
)

from agent import VisionReactAgent

is_first_segment = {}


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    project_id = event.get('project_id', 'default')
    segment_index = event.get('segment_index', event)
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    segment_count = event.get('segment_count', 0)

    if isinstance(segment_index, dict):
        segment_index = segment_index.get('segment_index', 0)

    # Get project settings
    language = get_project_language(project_id)
    document_prompt = get_project_document_prompt(project_id)
    print(f'Project {project_id} language: {language}')
    if document_prompt:
        print(f'Project {project_id} has custom document prompt ({len(document_prompt)} chars)')

    if workflow_id not in is_first_segment:
        is_first_segment[workflow_id] = True
        record_step_start(workflow_id, StepName.SEGMENT_ANALYZER)

    # Get segment data from S3
    segment_data = get_segment_analysis(file_uri, segment_index)

    if not segment_data:
        print(f'Segment {segment_index} not found in S3 for file {file_uri}')
        return {
            'workflow_id': workflow_id,
            'segment_index': segment_index,
            'status': 'not_found'
        }

    image_uri = segment_data.get('image_uri', '')
    bda_content = segment_data.get('bda_indexer', '')
    pdf_text = segment_data.get('format_parser', '')
    ocr_text = segment_data.get('paddleocr', '')
    segment_type = segment_data.get('segment_type', 'PAGE')
    video_uri = segment_data.get('file_uri', file_uri)
    start_timecode = segment_data.get('start_timecode_smpte', '')
    end_timecode = segment_data.get('end_timecode_smpte', '')

    context_parts = []
    if bda_content:
        context_parts.append(f'## BDA Indexer:\n{bda_content}')
    if pdf_text:
        context_parts.append(f'## Format Parser:\n{pdf_text}')
    if ocr_text:
        context_parts.append(f'## PaddleOCR:\n{ocr_text}')

    context = '\n\n'.join(context_parts) if context_parts else 'No prior analysis available.'

    # Update status to ANALYZING
    update_segment_status(file_uri, segment_index, SegmentStatus.ANALYZING)

    try:
        agent = VisionReactAgent(
            model_id=os.environ.get('BEDROCK_MODEL_ID', 'us.anthropic.claude-3-7-sonnet-20250219-v1:0'),
            region=os.environ.get('AWS_REGION', 'us-east-1'),
            video_model_id=os.environ.get('BEDROCK_VIDEO_MODEL_ID', 'us.twelvelabs.pegasus-1-2-v1:0'),
            bucket_owner_account_id=os.environ.get('BUCKET_OWNER_ACCOUNT_ID', '')
        )

        result = agent.analyze(
            document_id=workflow_id,
            segment_id=f'{workflow_id}_{segment_index:04d}',
            segment_index=segment_index,
            image_uri=image_uri,
            context=context,
            file_type=file_type,
            language=language,
            user_instructions=document_prompt,
            segment_type=segment_type,
            video_uri=video_uri,
            start_timecode=start_timecode,
            end_timecode=end_timecode
        )

        analysis_steps = result.get('analysis_steps', [])
        is_video = segment_type in ('VIDEO', 'CHAPTER')

        for step in analysis_steps:
            question = step.get('question', '')
            answer = step.get('answer', '')
            if question and answer:
                add_segment_ai_analysis(
                    file_uri=file_uri,
                    segment_index=segment_index,
                    analysis_query=question,
                    content=answer
                )

        if not analysis_steps:
            add_segment_ai_analysis(
                file_uri=file_uri,
                segment_index=segment_index,
                analysis_query=f'Chapter {segment_index + 1}' if is_video else f'Page {segment_index + 1}',
                content=result.get('response', '')
            )

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
        is_video = segment_type in ('VIDEO', 'CHAPTER')

        # Update status to FAILED
        update_segment_status(file_uri, segment_index, SegmentStatus.FAILED, error=str(e))

        # Save error to S3
        add_segment_ai_analysis(
            file_uri=file_uri,
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
