export interface SearchInput {
  project_id: string;
  query: string;
  document_id?: string;
  limit?: number;
}

export interface HybridResult {
  workflow_id: string;
  document_id: string;
  segment_id: string;
  segment_index: number;
  content: string;
  keywords: string;
  score: number;
}

export interface SearchAnswer {
  answer: string;
  sources: Array<{
    document_id: string;
    segment_id: string;
  }>;
}

export interface OverviewInput {
  project_id: string;
}

export interface DocumentOverview {
  document_id: string;
  language: string;
  document_summary: string;
  total_pages: number;
}

export interface OverviewOutput {
  documents: DocumentOverview[];
}
