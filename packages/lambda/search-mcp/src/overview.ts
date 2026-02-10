import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import type { OverviewInput, OverviewOutput, DocumentOverview } from './types';

const s3Client = new S3Client({});

interface SummaryJson {
  language: string;
  document_summary: string;
  total_pages: number;
}

export const handler = async (
  event: OverviewInput,
): Promise<OverviewOutput> => {
  const bucket = process.env.DOCUMENT_STORAGE_BUCKET;
  const prefix = `projects/${event.project_id}/documents/`;

  // List all objects under the project's documents folder
  const listCommand = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  });

  const listResponse = await s3Client.send(listCommand);
  // Key format: projects/{project_id}/documents/{document_id}/analysis/summary.json
  const summaryKeys =
    listResponse.Contents?.flatMap((obj) =>
      obj.Key?.endsWith('/analysis/summary.json') ? [obj.Key] : [],
    ) ?? [];

  // Fetch all summary.json files in parallel
  const documents: DocumentOverview[] = await Promise.all(
    summaryKeys.map(async (key) => {
      const getCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      const response = await s3Client.send(getCommand);
      const body = await response.Body?.transformToString();
      const summary: SummaryJson = JSON.parse(body ?? '{}');

      // Extract document_id from key: projects/{project_id}/documents/{document_id}/analysis/summary.json
      const parts = key.split('/');
      const documentId = parts[parts.length - 3];

      return {
        document_id: documentId,
        language: summary.language,
        document_summary: summary.document_summary,
        total_pages: summary.total_pages,
      };
    }),
  );

  return { documents };
};
