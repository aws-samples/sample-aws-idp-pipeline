import { LoadArtifactInput, LoadArtifactOutput } from './models.js';
import { getFromS3 } from './s3.js';
import { getArtifactMetadata } from './dynamodb.js';

function isTextContentType(contentType: string): boolean {
  return (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/xml'
  );
}

export const handler = async (
  event: LoadArtifactInput,
): Promise<LoadArtifactOutput> => {
  const { artifact_id } = event;

  const table = process.env.BACKEND_TABLE_NAME;

  // Get metadata from DynamoDB
  const metadata = await getArtifactMetadata(table, artifact_id);

  if (!metadata) {
    throw new Error(`Artifact not found: ${artifact_id}`);
  }

  const { filename, content_type, s3_key, s3_bucket } = metadata.data;
  const { created_at } = metadata;

  // Get content from S3
  const bodyBytes = await getFromS3(s3_bucket, s3_key);

  const isText = isTextContentType(content_type);
  const content = isText
    ? Buffer.from(bodyBytes).toString('utf8')
    : Buffer.from(bodyBytes).toString('base64');

  return {
    artifact_id,
    filename,
    content_type,
    content,
    encoding: isText ? 'text' : 'base64',
    created_at,
  };
};
