export interface SaveArtifactInput {
  user_id: string;
  project_id: string;
  filename: string;
  content: string;
  content_type: string;
  encoding?: 'text' | 'base64';
}

export interface SaveArtifactOutput {
  artifact_id: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  created_at: string;
}

export interface LoadArtifactInput {
  artifact_id: string;
}

export interface LoadArtifactOutput {
  artifact_id: string;
  filename: string;
  content_type: string;
  content: string;
  encoding: 'text' | 'base64';
  created_at: string;
}
