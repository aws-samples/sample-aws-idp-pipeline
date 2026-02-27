import { queryWorkflows, pickLatestWorkflow } from './clients.js';
import type { GetSegmentsInput, GetSegmentsOutput } from './types.js';

export async function handler(
  event: GetSegmentsInput,
): Promise<GetSegmentsOutput> {
  const { document_id } = event;

  const workflows = await queryWorkflows(document_id);
  if (workflows.length === 0) {
    throw new Error(`No workflows found for document ${document_id}`);
  }

  const wf = pickLatestWorkflow(workflows)!;
  const workflowId = wf.SK.replace('WF#', '');

  return {
    workflow_id: workflowId,
    document_id,
    total_segments: wf.data.total_segments ?? 0,
    file_name: wf.data.file_name,
    file_uri: wf.data.file_uri,
    file_type: wf.data.file_type,
    status: wf.data.status,
  };
}
