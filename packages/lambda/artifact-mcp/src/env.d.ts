declare global {
  namespace NodeJS {
    interface ProcessEnv {
      AGENT_STORAGE_BUCKET: string;
      BACKEND_TABLE_NAME: string;
      ELASTICACHE_ENDPOINT: string;
      WEBSOCKET_CALLBACK_URL: string;
    }
  }
}

export {};
