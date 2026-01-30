declare global {
  namespace NodeJS {
    interface ProcessEnv {
      AGENT_STORAGE_BUCKET: string;
      BACKEND_TABLE_NAME: string;
      WEBSOCKET_MESSAGE_QUEUE_URL: string;
    }
  }
}

export {};
