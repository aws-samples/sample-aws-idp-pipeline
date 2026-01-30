export interface SaveMarkdownInput {
  user_id: string;
  project_id: string;
  filename: string;
  content: string;
}

export interface SaveMarkdownOutput {
  artifact_id: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  created_at: string;
}

export interface LoadMarkdownInput {
  artifact_id: string;
}

export interface LoadMarkdownOutput {
  artifact_id: string;
  filename: string;
  content: string;
  created_at: string;
}

export interface EditMarkdownInput {
  artifact_id: string;
  content: string;
}

export interface EditMarkdownOutput {
  artifact_id: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  updated_at: string;
}
