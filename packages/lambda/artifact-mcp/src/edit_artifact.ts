import { EditArtifactInput, EditArtifactOutput } from './models.js';
import { uploadToS3 } from './s3.js';
import { getArtifactMetadata, updateArtifactMetadata } from './dynamodb.js';

export const handler = async (
  event: EditArtifactInput,
): Promise<EditArtifactOutput> => {
  const { artifact_id, content, encoding = 'text' } = event;

  const bucket = process.env.AGENT_STORAGE_BUCKET;
  const table = process.env.BACKEND_TABLE_NAME;

  const metadata = await getArtifactMetadata(table, artifact_id);
  if (!metadata) {
    throw new Error(`Artifact not found: ${artifact_id}`);
  }

  const { s3_key, s3_bucket, filename, content_type } = metadata.data;
  const updatedAt = new Date().toISOString();

  const body = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
  const fileSize =
    encoding === 'base64'
      ? Buffer.from(content, 'base64').length
      : Buffer.byteLength(content, 'utf8');

  await uploadToS3(bucket, s3_key, body, content_type);

  await updateArtifactMetadata(table, artifact_id, fileSize, updatedAt);

  return {
    artifact_id,
    filename,
    s3_bucket,
    s3_key,
    updated_at: updatedAt,
  };
};
