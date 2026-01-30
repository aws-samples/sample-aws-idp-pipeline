import { nanoid } from 'nanoid';
import { SaveMarkdownInput, SaveMarkdownOutput } from './models.js';
import { uploadToS3 } from './s3.js';
import { saveArtifactMetadata } from './dynamodb.js';
import { sendWebsocketMessage, ArtifactsMessage } from './sqs.js';

const CONTENT_TYPE = 'text/markdown';

function generateArtifactId(): string {
  return `art_${nanoid()}`;
}

function ensureMdExtension(filename: string): string {
  if (filename.endsWith('.md')) {
    return filename;
  }
  return `${filename}.md`;
}

export const handler = async (
  event: SaveMarkdownInput,
): Promise<SaveMarkdownOutput> => {
  const { user_id, project_id, filename: rawFilename, content } = event;

  const filename = ensureMdExtension(rawFilename);
  const artifactId = generateArtifactId();
  const s3Key = `${user_id}/${project_id}/artifacts/${artifactId}.md`;
  const createdAt = new Date().toISOString();

  const bucket = process.env.AGENT_STORAGE_BUCKET;
  const table = process.env.BACKEND_TABLE_NAME;

  const fileSize = Buffer.byteLength(content, 'utf8');

  await uploadToS3(bucket, s3Key, content, CONTENT_TYPE);

  await saveArtifactMetadata(table, {
    artifact_id: artifactId,
    created_at: createdAt,
    data: {
      user_id,
      project_id,
      filename,
      content_type: CONTENT_TYPE,
      s3_key: s3Key,
      s3_bucket: bucket,
      file_size: fileSize,
    },
  });

  const message: ArtifactsMessage = {
    action: 'artifacts',
    data: {
      event: 'created',
      artifactId,
      artifactFileName: filename,
      timestamp: createdAt,
    },
  };
  await sendWebsocketMessage(user_id, message);

  return {
    artifact_id: artifactId,
    filename,
    s3_bucket: bucket,
    s3_key: s3Key,
    created_at: createdAt,
  };
};
