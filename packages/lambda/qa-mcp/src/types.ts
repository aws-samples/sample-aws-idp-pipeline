export interface GetSegmentsInput {
  project_id: string;
  document_id: string;
}

export interface GetSegmentsOutput {
  workflow_id: string;
  document_id: string;
  total_segments: number;
  file_name: string;
  file_uri: string;
  file_type: string;
  status: string;
}

export interface AddQaInput {
  project_id: string;
  document_id: string;
  segment_index: number;
  question: string;
  user_instructions?: string;
}

export interface AddQaOutput {
  analysis_query: string;
  content: string;
  qa_index: number;
}
