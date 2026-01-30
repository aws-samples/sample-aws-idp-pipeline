import { EditMarkdownInput, EditMarkdownOutput } from './models.js';
import { uploadToS3 } from './s3.js';
import { getArtifactMetadata, updateArtifactMetadata } from './dynamodb.js';

const CONTENT_TYPE = 'text/markdown';

export const handler = async (
  event: EditMarkdownInput,
): Promise<EditMarkdownOutput> => {
  const { artifact_id, content } = event;

  const bucket = process.env.AGENT_STORAGE_BUCKET;
  const table = process.env.BACKEND_TABLE_NAME;

  const metadata = await getArtifactMetadata(table, artifact_id);
  if (!metadata) {
    throw new Error(`Artifact not found: ${artifact_id}`);
  }

  const { s3_key, s3_bucket, filename } = metadata.data;
  const updatedAt = new Date().toISOString();

  const fileSize = Buffer.byteLength(content, 'utf8');

  await uploadToS3(bucket, s3_key, content, CONTENT_TYPE);

  await updateArtifactMetadata(table, artifact_id, fileSize, updatedAt);

  return {
    artifact_id,
    filename,
    s3_bucket,
    s3_key,
    updated_at: updatedAt,
  };
};
