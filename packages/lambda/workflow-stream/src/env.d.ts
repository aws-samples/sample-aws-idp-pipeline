declare namespace NodeJS {
  interface ProcessEnv {
    ELASTICACHE_ENDPOINT: string;
    WEBSOCKET_CALLBACK_URL: string;
    BACKEND_TABLE_NAME: string;
  }
}
