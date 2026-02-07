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
    document_id = event.get('document_id', '')
    project_id = event.get('project_id', 'default')
    segment_index = event.get('segment_index', event)
    file_uri = event.get('file_uri')
    file_type = event.get('file_type')
    segment_count = event.get('segment_count', 0)

    if isinstance(segment_index, dict):
        segment_index = segment_index.get('segment_index', 0)

    # Skip AI analysis for web documents (webcrawler already extracted content)
    # STEP record already has segment_analyzer as 'skipped' from workflow creation
    if file_type == 'application/x-webreq':
        print(f'Skipping AI analysis for web document: {file_uri}')
        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_count': segment_count,
            'language': 'ko',
            'status': 'skipped'
        }

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
            'document_id': document_id,
            'project_id': project_id,
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'language': language,
            'status': 'not_found'
        }

    image_uri = segment_data.get('image_uri', '')
    bda_content = segment_data.get('bda_indexer', '')
    pdf_text = segment_data.get('format_parser', '')
    ocr_text = segment_data.get('paddleocr', '')
    webcrawler_content = segment_data.get('webcrawler_content', '')
    transcribe_segments = segment_data.get('transcribe_segments', [])
    segment_type = segment_data.get('segment_type', 'PAGE')
    video_uri = segment_data.get('file_uri', file_uri)
    start_timecode = segment_data.get('start_timecode_smpte', '')
    end_timecode = segment_data.get('end_timecode_smpte', '')

    # Check for reanalysis instructions (takes priority over project settings)
    reanalysis_instructions = segment_data.get('reanalysis_instructions', '')

    context_parts = []
    if bda_content:
        context_parts.append(f'## BDA Indexer:\n{bda_content}')
    if pdf_text:
        context_parts.append(f'## Format Parser:\n{pdf_text}')
    if ocr_text:
        context_parts.append(f'## PaddleOCR:\n{ocr_text}')
    if webcrawler_content:
        context_parts.append(f'## Web Crawler:\n{webcrawler_content}')
    if transcribe_segments:
        # Format transcribe segments with timing info
        segments_text = []
        for seg in transcribe_segments:
            start = seg.get('start_time', '')
            end = seg.get('end_time', '')
            transcript = seg.get('transcript', '')
            segments_text.append(f'[{start}s - {end}s] {transcript}')
        context_parts.append(f'## Transcribe Segments:\n' + '\n'.join(segments_text))

    context = '\n\n'.join(context_parts) if context_parts else 'No prior analysis available.'

    # Update status to ANALYZING
    update_segment_status(file_uri, segment_index, SegmentStatus.ANALYZING)

    try:
        agent = VisionReactAgent(
            model_id=os.environ['BEDROCK_MODEL_ID'],
            region=os.environ.get('AWS_REGION', 'us-east-1'),
            video_model_id=os.environ['BEDROCK_VIDEO_MODEL_ID'],
            bucket_owner_account_id=os.environ.get('BUCKET_OWNER_ACCOUNT_ID', '')
        )

        # Use reanalysis_instructions if provided, otherwise use project document_prompt
        effective_instructions = reanalysis_instructions if reanalysis_instructions else document_prompt
        if reanalysis_instructions:
            print(f'Using reanalysis instructions ({len(reanalysis_instructions)} chars)')

        result = agent.analyze(
            document_id=workflow_id,
            segment_id=f'{workflow_id}_{segment_index:04d}',
            segment_index=segment_index,
            image_uri=image_uri,
            context=context,
            file_type=file_type,
            language=language,
            user_instructions=effective_instructions,
            segment_type=segment_type,
            video_uri=video_uri,
            start_timecode=start_timecode,
            end_timecode=end_timecode
        )

        analysis_steps = result.get('analysis_steps', [])
        is_media = segment_type in ('VIDEO', 'CHAPTER', 'AUDIO')

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
                analysis_query=f'Chapter {segment_index + 1}' if is_media else f'Page {segment_index + 1}',
                content=result.get('response', '')
            )

        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'language': language,
            'status': 'analyzed',
            'analysis_count': len(analysis_steps) if analysis_steps else 1
        }

    except Exception as e:
        print(f'Error in segment analysis: {e}')
        is_media = segment_type in ('VIDEO', 'CHAPTER', 'AUDIO')

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
            'document_id': document_id,
            'project_id': project_id,
            'segment_index': segment_index,
            'file_uri': file_uri,
            'file_type': file_type,
            'language': language,
            'status': 'failed',
            'error': str(e)
        }
