declare namespace NodeJS {
  interface ProcessEnv {
    WEBSOCKET_MESSAGE_QUEUE_URL: string;
    BACKEND_TABLE_NAME: string;
  }
}
