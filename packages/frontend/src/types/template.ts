export type TemplateStatus =
  | 'uploaded'
  | 'analyzing'
  | 'completed'
  | 'failed';

// Matches the backend TemplateResponse (GET /templates/{id}).
export interface TemplateDetail {
  template_id: string;
  name: string;
  description: string;
  template_type?: string | null;
  thumbnail_url?: string | null;
  status: TemplateStatus;
  generated_prompt?: string | null;
  created_at: string;
}

// Matches the backend TemplateDownloadResponse (GET /templates/{id}/download).
export interface TemplateDownload {
  download_url: string;
  file_name: string;
}

// Payload of the `template` WebSocket action.
// Fields other than templateId/event/timestamp are optional patches: only the
// values that changed are sent, and the detail page merges them into state.
export interface TemplateMessageData {
  event: 'status_changed' | 'updated';
  templateId: string;
  status?: TemplateStatus;
  previousStatus?: TemplateStatus;
  template_type?: string | null;
  thumbnail_url?: string | null;
  generated_prompt?: string | null;
  timestamp: string;
}
