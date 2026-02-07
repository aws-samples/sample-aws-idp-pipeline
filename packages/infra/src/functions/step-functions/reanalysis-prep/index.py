"""
Reanalysis Preparation Lambda

Prepares existing segments for re-analysis:
1. Counts existing segment files from S3
2. Clears ai_analysis from each segment
3. Saves reanalysis_instructions to each segment
4. Returns segment_ids for Map processing
"""
import json

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    update_workflow_status,
    get_entity_prefix,
        StepName,
    WorkflowStatus,
)
from shared.s3_analysis import (
    get_segment_count_from_s3,
    clear_segment_ai_analysis,
    save_reanalysis_instructions,
)


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    document_id = event.get('document_id')
    project_id = event.get('project_id', 'default')
    file_uri = event.get('file_uri')
    file_type = event.get('file_type', '')
    user_instructions = event.get('user_instructions', '')

    record_step_start(workflow_id, StepName.SEGMENT_BUILDER)

    try:
        # Get segment count from existing S3 files
        segment_count = get_segment_count_from_s3(file_uri)
        print(f'Found {segment_count} existing segments')

        if segment_count == 0:
            raise ValueError(f'No segments found for file: {file_uri}')

        # Prepare each segment for re-analysis
        for i in range(segment_count):
            # Clear existing ai_analysis
            clear_segment_ai_analysis(file_uri, i)

            # Save reanalysis instructions if provided
            if user_instructions:
                save_reanalysis_instructions(file_uri, i, user_instructions)

            print(f'Prepared segment {i} for re-analysis')

        record_step_complete(
            workflow_id,
            StepName.SEGMENT_BUILDER,
            segment_count=segment_count
        )

        return {
            'workflow_id': workflow_id,
            'document_id': document_id,
            'project_id': project_id,
            'file_uri': file_uri,
            'file_type': file_type,
            'segment_ids': list(range(segment_count)),
            'segment_count': segment_count,
            'is_reanalysis': True
        }

    except Exception as e:
        error_msg = str(e)
        print(f'Error in reanalysis-prep: {error_msg}')
        record_step_error(workflow_id, StepName.SEGMENT_BUILDER, error_msg)
        entity_type = get_entity_prefix(file_type)
        update_workflow_status(document_id, workflow_id, WorkflowStatus.FAILED, entity_type=entity_type, error=error_msg)
        raise
