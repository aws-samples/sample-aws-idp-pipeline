export const PADDLEOCR_ENDPOINT_NAME_VALUE = 'paddleocr-endpoint';

export const SSM_KEYS = {
  LANCEDB_LOCK_TABLE_NAME: '/idp-v2/lancedb/lock/table-name',
  DOCUMENT_STORAGE_BUCKET_NAME: '/idp-v2/document-storage/bucket-name',
  SESSION_STORAGE_BUCKET_NAME: '/idp-v2/session-storage/bucket-name',
  AGENT_STORAGE_BUCKET_NAME: '/idp-v2/agent-storage/bucket-name',
  MODEL_ARTIFACTS_BUCKET_NAME: '/idp-v2/model-artifacts/bucket-name',
  BACKEND_TABLE_NAME: '/idp-v2/backend/table-name',
  BACKEND_TABLE_STREAM_ARN: '/idp-v2/backend/table-stream-arn',
  LANCEDB_EXPRESS_BUCKET_NAME: '/idp-v2/lancedb/express/bucket-name',
  LANCEDB_EXPRESS_AZ_ID: '/idp-v2/lancedb/express/az-id',
  VPC_ID: '/idp-v2/vpc/id',
  AGENT_RUNTIME_ARN: '/idp-v2/agent/runtime-arn',
  RESEARCH_AGENT_RUNTIME_ARN: '/idp-v2/research-agent/runtime-arn',
  BIDI_AGENT_RUNTIME_ARN: '/idp-v2/bidi-agent/runtime-arn',
  PADDLEOCR_ENDPOINT_NAME: '/idp-v2/paddleocr/endpoint-name',
  BACKEND_URL: '/idp-v2/backend/url',
  SEARCH_MCP_FUNCTION_ARN: '/idp-v2/mcp/search/function-arn',
  SEARCH_MCP_ROLE_ARN: '/idp-v2/mcp/search/role-arn',
  ELASTICACHE_ENDPOINT: '/idp-v2/elasticache/endpoint',
  STEP_FUNCTION_ARN: '/idp-v2/stepfunction/arn',
  WEBSOCKET_API_ID: '/idp-v2/websocket/api-id',
  WEBSOCKET_CALLBACK_URL: '/idp-v2/websocket/callback-url',
  WEBSOCKET_CONNECT_ROLE_ARN: '/idp-v2/websocket/connect-role-arn',
  // Preprocessing queues
  PREPROCESS_OCR_QUEUE_URL: '/idp-v2/preprocess/ocr/queue-url',
  PREPROCESS_BDA_QUEUE_URL: '/idp-v2/preprocess/bda/queue-url',
  PREPROCESS_TRANSCRIBE_QUEUE_URL: '/idp-v2/preprocess/transcribe/queue-url',
  PREPROCESS_WORKFLOW_QUEUE_URL: '/idp-v2/preprocess/workflow/queue-url',
  QA_REGENERATOR_FUNCTION_ARN: '/idp-v2/qa-regenerator/function-arn',
  WEBSOCKET_MESSAGE_QUEUE_ARN: '/idp-v2/websocket/message-queue-arn',
  // External services
  UNSPLASH_ACCESS_KEY: '/idp-v2/external-service/unsplash/access-key',
  // WebCrawler
  WEBCRAWLER_AGENT_RUNTIME_ARN: '/idp-v2/webcrawler-agent/runtime-arn',
} as const;
