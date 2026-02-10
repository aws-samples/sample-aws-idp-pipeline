import * as duckdb from 'duckdb';
import type { OverviewInput, OverviewOutput, DocumentOverview } from './types';

const runQuery = (
  conn: duckdb.Connection,
  sql: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const allQuery = <T>(
  conn: duckdb.Connection,
  sql: string,
): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
};

export const handler = async (event: OverviewInput): Promise<OverviewOutput> => {
  const bucket = process.env.DOCUMENT_STORAGE_BUCKET;
  const db = new duckdb.Database(':memory:');
  const conn = db.connect();

  // S3 httpfs 설정 (Lambda 환경에서는 AWS credentials 자동 사용)
  await runQuery(conn, 'INSTALL httpfs; LOAD httpfs;');
  await runQuery(conn, "SET s3_region='ap-northeast-2';");

  const query = `
    SELECT
      split_part(filename, '/documents/', 2).split('/')[1] AS document_id,
      language,
      document_summary,
      total_pages
    FROM read_json('s3://${bucket}/projects/${event.project_id}/documents/**/summary.json')
  `;

  const result = await allQuery<DocumentOverview>(conn, query);
  conn.close();
  db.close();

  return { documents: result };
};
