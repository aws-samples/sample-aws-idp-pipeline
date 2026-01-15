export const SSM_KEYS = {
  LANCEDB_STORAGE_BUCKET_NAME: '/idp-v2/lancedb/storage/bucket-name',
  LANCEDB_LOCK_TABLE_NAME: '/idp-v2/lancedb/lock/table-name',
  DOCUMENT_STORAGE_BUCKET_NAME: '/idp-v2/document-storage/bucket-name',
  SESSION_STORAGE_BUCKET_NAME: '/idp-v2/session-storage/bucket-name',
  BACKEND_TABLE_NAME: '/idp-v2/backend/table-name',
  LANCEDB_EXPRESS_BUCKET_NAME: '/idp-v2/lancedb/express/bucket-name',
  LANCEDB_EXPRESS_AZ_ID: '/idp-v2/lancedb/express/az-id',
  VPC_ID: '/idp-v2/vpc/id',
  AGENT_RUNTIME_ARN: '/idp-v2/agent/runtime-arn',
  WEBSOCKET_ENDPOINT: '/idp-v2/websocket/endpoint',
} as const;
