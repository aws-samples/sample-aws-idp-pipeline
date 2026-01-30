import { LoadMarkdownInput, LoadMarkdownOutput } from './models.js';
import { getFromS3 } from './s3.js';
import { getArtifactMetadata } from './dynamodb.js';

export const handler = async (
  event: LoadMarkdownInput,
): Promise<LoadMarkdownOutput> => {
  const { artifact_id } = event;

  const table = process.env.BACKEND_TABLE_NAME;

  const metadata = await getArtifactMetadata(table, artifact_id);

  if (!metadata) {
    throw new Error(`Artifact not found: ${artifact_id}`);
  }

  const { filename, s3_key, s3_bucket } = metadata.data;
  const { created_at } = metadata;

  const bodyBytes = await getFromS3(s3_bucket, s3_key);
  const content = Buffer.from(bodyBytes).toString('utf8');

  return {
    artifact_id,
    filename,
    content,
    created_at,
  };
};
