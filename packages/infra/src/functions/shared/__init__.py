# Shared module exports
# Note: lancedb_client and embeddings are NOT imported here
# because they require lancedb library which is only available
# in the container Lambda. Import them directly when needed.

from .ddb_client import (
    generate_workflow_id,
    create_workflow,
    update_workflow_status,
    get_workflow,
    get_steps,
    record_step_start,
    record_step_complete,
    record_step_error,
    save_segment,
    update_segment,
    get_segment,
    get_all_segments,
    get_segment_count,
    add_image_analysis,
    batch_save_segments,
    WorkflowStatus,
    StepName,
)

__all__ = [
    'generate_workflow_id',
    'create_workflow',
    'update_workflow_status',
    'get_workflow',
    'get_steps',
    'record_step_start',
    'record_step_complete',
    'record_step_error',
    'save_segment',
    'update_segment',
    'get_segment',
    'get_all_segments',
    'get_segment_count',
    'add_image_analysis',
    'batch_save_segments',
    'WorkflowStatus',
    'StepName',
]
