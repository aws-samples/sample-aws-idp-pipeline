export interface Document {
  document_id: string;
  name: string;
  file_type: string;
  file_size: number;
  status: string;
  started_at: string;
  ended_at: string | null;
}

export interface DocumentUploadResponse {
  document_id: string;
  upload_url: string;
  file_name: string;
}

export interface Workflow {
  workflow_id: string;
  document_id: string;
  status: string;
  file_name: string;
  file_uri: string;
  language: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowSummary {
  workflow_id: string;
  status: string;
  file_name: string;
  file_uri: string;
  language: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentWorkflows {
  document_id: string;
  document_name: string;
  workflows: WorkflowSummary[];
}

export interface OcrBlock {
  block_id: number;
  block_label: string;
  block_content: string;
  block_bbox: number[]; // [x1, y1, x2, y2]
  block_order: number | null;
  group_id: number;
}

export interface PaddleOcrBlocks {
  blocks: OcrBlock[];
  width: number | null;
  height: number | null;
}

export interface SegmentData {
  segment_index: number;
  segment_type?: 'PAGE' | 'VIDEO' | 'CHAPTER';
  image_uri: string;
  image_url: string | null;
  file_uri?: string;
  video_url?: string | null;
  start_timecode_smpte?: string;
  end_timecode_smpte?: string;
  bda_indexer: string;
  paddleocr: string;
  paddleocr_blocks?: PaddleOcrBlocks;
  format_parser: string;
  ai_analysis: { analysis_query: string; content: string }[];
}

export interface WorkflowDetail {
  workflow_id: string;
  document_id: string;
  status: string;
  file_name: string;
  file_uri: string;
  file_type: string;
  language: string | null;
  total_segments: number;
  created_at: string;
  updated_at: string;
  segments: SegmentData[];
}

export interface ChatAttachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  preview: string | null; // data URL for images
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  timestamp: Date;
}

export interface ChatSession {
  session_id: string;
  session_type: string;
  created_at: string;
  updated_at: string;
  session_name: string | null;
}

export interface WorkflowProgress {
  workflowId: string;
  documentId: string;
  fileName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  currentStep: string;
  stepMessage: string;
  segmentProgress: { completed: number; total: number } | null;
  error: string | null;
}

export interface AnalysisPopup {
  type: 'bda' | 'ocr' | 'pdf' | 'ai' | null;
  content: string;
  title: string;
  qaItems: { question: string; answer: string }[];
}

export interface Agent {
  name: string;
  content?: string; // system prompt (only in detail response)
  created_at: string;
  updated_at: string;
}

export type ArtifactType = 'code' | 'table' | 'chart' | 'markdown' | 'image';

export interface Artifact {
  artifact_id: string;
  session_id: string;
  project_id: string;
  project_name: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string; // for code artifacts
  created_at: string;
}
