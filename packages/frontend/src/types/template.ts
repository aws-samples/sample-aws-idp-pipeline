export type TemplateStatus = 'uploading' | 'analyzing' | 'completed' | 'failed';

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
