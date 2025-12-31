declare namespace NodeJS {
  interface ProcessEnv {
    LANCEDB_STORAGE_BUCKET_NAME: string;
    LANCEDB_LOCK_TABLE_NAME: string;
    DOCUMENT_STORAGE_BUCKET_NAME: string;
    BACKEND_TABLE_NAME: string;
  }
}
