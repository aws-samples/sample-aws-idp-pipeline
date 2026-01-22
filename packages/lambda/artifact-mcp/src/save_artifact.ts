import { nanoid } from 'nanoid';
import { SaveArtifactInput, SaveArtifactOutput } from './models.js';
import { uploadToS3, getPresignedUrl } from './s3.js';
import { saveArtifactMetadata } from './dynamodb.js';

function generateArtifactId(): string {
  return `art_${nanoid()}`;
}

function getExtensionFromFilename(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export const handler = async (
  event: SaveArtifactInput,
): Promise<SaveArtifactOutput> => {
  const {
    user_id,
    project_id,
    filename,
    content,
    content_type,
    encoding = 'text',
  } = event;

  const artifactId = generateArtifactId();
  const ext = getExtensionFromFilename(filename);
  const s3Key = `${user_id}/${project_id}/artifacts/${artifactId}${ext ? `.${ext}` : ''}`;
  const createdAt = new Date().toISOString();

  const bucket = process.env.AGENT_STORAGE_BUCKET;
  const table = process.env.BACKEND_TABLE_NAME;

  const body = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
  const fileSize =
    encoding === 'base64'
      ? Buffer.from(content, 'base64').length
      : Buffer.byteLength(content, 'utf8');

  // Upload to S3
  await uploadToS3(bucket, s3Key, body, content_type);

  // Save metadata to DynamoDB
  await saveArtifactMetadata(table, {
    artifact_id: artifactId,
    created_at: createdAt,
    data: {
      user_id,
      project_id,
      filename,
      content_type,
      s3_key: s3Key,
      s3_bucket: bucket,
      file_size: fileSize,
    },
  });

  // Generate presigned URL (1 hour)
  const url = await getPresignedUrl(bucket, s3Key);

  return {
    artifact_id: artifactId,
    filename,
    s3_key: s3Key,
    url,
    created_at: createdAt,
  };
};
