import json
import os

import boto3

from shared.ddb_client import (
    get_all_segments,
    update_workflow_status,
    record_step_start,
    record_step_complete,
    record_step_error,
    StepName,
    WorkflowStatus,
)
from shared.websocket import (
    notify_step_start,
    notify_step_complete,
    notify_step_error,
    notify_workflow_complete,
)

bedrock_client = None


def get_bedrock_client():
    global bedrock_client
    if bedrock_client is None:
        bedrock_client = boto3.client(
            'bedrock-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return bedrock_client


def generate_summary(content: str, model_id: str) -> str:
    client = get_bedrock_client()

    prompt = f"""Summarize the following document analysis results in Korean.
Provide a structured summary with:
1. Document Overview (1-2 sentences)
2. Key Findings (3-5 bullet points)
3. Important Data Points
4. Conclusion

Document Analysis:
{content[:50000]}

Summary:"""

    try:
        response = client.invoke_model(
            modelId=model_id,
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 2048,
                'messages': [
                    {'role': 'user', 'content': prompt}
                ]
            }),
            contentType='application/json'
        )

        result = json.loads(response['body'].read())
        return result.get('content', [{}])[0].get('text', '')

    except Exception as e:
        print(f'Error generating summary: {e}')
        return f'Summary generation failed: {e}'


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    segment_count = event.get('segment_count', 0)
    model_id = os.environ.get('SUMMARIZER_MODEL_ID', 'us.anthropic.claude-3-5-haiku-20241022-v1:0')

    record_step_complete(workflow_id, StepName.SEGMENT_ANALYZER, segment_count=segment_count)
    notify_step_complete(workflow_id, 'SegmentAnalyzer', segment_count=segment_count)

    record_step_start(workflow_id, StepName.DOCUMENT_SUMMARIZER)
    notify_step_start(workflow_id, 'DocumentSummarizer')

    try:
        segments = get_all_segments(workflow_id)

        if not segments:
            print(f'No segments found for workflow {workflow_id}')
            record_step_complete(
                workflow_id,
                StepName.DOCUMENT_SUMMARIZER,
                skipped=True,
                reason='No segments found'
            )
            notify_step_complete(workflow_id, 'DocumentSummarizer', message='No segments')
            return {
                'workflow_id': workflow_id,
                'status': 'no_segments',
                'message': 'No segments found for summarization'
            }

        segments_sorted = sorted(segments, key=lambda x: x.get('segment_index', 0))

        all_content = []
        for seg in segments_sorted:
            segment_index = seg.get('segment_index', 0)
            parts = []

            bda_indexer = seg.get('bda_indexer', '')
            if bda_indexer:
                parts.append(f'BDA: {bda_indexer[:500]}')

            format_parser = seg.get('format_parser', '')
            if format_parser:
                parts.append(f'PDF: {format_parser[:500]}')

            image_analysis = seg.get('image_analysis', [])
            for analysis in image_analysis:
                content = analysis.get('content', '')
                if content:
                    parts.append(f'AI: {content[:500]}')

            if parts:
                all_content.append(f"### Page {segment_index + 1}\n" + '\n'.join(parts))

        combined_content = '\n\n'.join(all_content)

        summary = generate_summary(combined_content, model_id)

        record_step_complete(
            workflow_id,
            StepName.DOCUMENT_SUMMARIZER,
            segment_count=len(segments)
        )
        notify_step_complete(workflow_id, 'DocumentSummarizer')

        update_workflow_status(
            workflow_id,
            WorkflowStatus.COMPLETED,
            summary=summary
        )

        notify_workflow_complete(
            workflow_id,
            summary=summary,
            segment_count=len(segments)
        )

        print(f'Generated summary for workflow {workflow_id} with {len(segments)} segments')

        return {
            'workflow_id': workflow_id,
            'status': 'completed',
            'segment_count': len(segments),
            'summary': summary,
            'summary_length': len(summary)
        }

    except Exception as e:
        print(f'Error in document summarization: {e}')
        record_step_error(workflow_id, StepName.DOCUMENT_SUMMARIZER, str(e))
        notify_step_error(workflow_id, 'DocumentSummarizer', str(e))
        update_workflow_status(workflow_id, WorkflowStatus.FAILED, error=str(e))
        return {
            'workflow_id': workflow_id,
            'status': 'failed',
            'error': str(e)
        }
