export interface Document {
  document_id: string;
  name: string;
  file_type: string;
  file_size: number;
  status: string;
  use_bda: boolean;
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

export interface TranscribeSegment {
  start_time: number;
  end_time: number;
  transcript: string;
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
  paddleocr_blocks: PaddleOcrBlocks | null;
  format_parser: string;
  ai_analysis: { analysis_query: string; content: string }[];
  transcribe_segments?: TranscribeSegment[] | null;
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

export interface ChatArtifact {
  artifact_id: string;
  filename: string;
  url: string;
  s3_key?: string;
  s3_bucket?: string;
  created_at?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  timestamp: Date;
  isToolResult?: boolean;
  toolResultType?: 'image' | 'artifact' | 'text';
  artifact?: ChatArtifact;
}

export interface ChatSession {
  session_id: string;
  session_type: string;
  created_at: string;
  updated_at: string;
  session_name: string | null;
  agent_id?: string | null;
}

export interface StepStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  label: string;
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
  steps?: Record<string, StepStatus>;
}

export interface AnalysisPopup {
  type: 'bda' | 'ocr' | 'pdf' | 'ai' | 'stt' | null;
  content: string;
  title: string;
  qaItems: { question: string; answer: string }[];
}

export interface Agent {
  agent_id: string;
  name: string;
  content?: string; // system prompt (only in detail response)
  created_at: string;
}

export interface Artifact {
  artifact_id: string;
  user_id: string;
  project_id: string;
  filename: string;
  content_type: string;
  s3_key: string;
  s3_bucket: string;
  file_size: number;
  created_at: string;
}

export interface ArtifactsResponse {
  items: Artifact[];
  next_cursor: string | null;
}
