import { connect } from '@lancedb/lancedb';

export const connectLanceDb = () => {
  return connect(
    `s3+ddb://${process.env.LANCEDB_STORAGE_BUCKET_NAME}/idp-v2?ddbTableName=${process.env.LANCEDB_LOCK_TABLE_NAME}`,
  );
};
