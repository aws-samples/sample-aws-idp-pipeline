import {
  queryWorkflows,
  pickLatestWorkflow,
  getProjectLanguage,
  invokeQaRegenerator,
} from './clients.js';
import type { AddQaInput, AddQaOutput } from './types.js';

export async function handler(event: AddQaInput): Promise<AddQaOutput> {
  const {
    project_id,
    document_id,
    segment_index,
    question,
    user_instructions = '',
  } = event;

  const workflows = await queryWorkflows(document_id);
  if (workflows.length === 0) {
    throw new Error(`No workflows found for document ${document_id}`);
  }

  const wf = pickLatestWorkflow(workflows)!;
  const workflowId = wf.SK.replace('WF#', '');

  if (!['completed', 'failed'].includes(wf.data.status)) {
    throw new Error(
      `Workflow must be completed or failed. Current status: ${wf.data.status}`,
    );
  }

  const language = await getProjectLanguage(project_id);

  const result = await invokeQaRegenerator({
    mode: 'add',
    file_uri: wf.data.file_uri,
    segment_index,
    question,
    user_instructions,
    language,
    workflow_id: workflowId,
    document_id,
    project_id,
    file_type: wf.data.file_type,
  });

  return {
    analysis_query: (result.analysis_query as string) ?? question,
    content: (result.content as string) ?? '',
    qa_index: (result.qa_index as number) ?? 0,
  };
}
