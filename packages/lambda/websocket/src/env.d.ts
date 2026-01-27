declare global {
  namespace NodeJS {
    interface ProcessEnv {
      ELASTICACHE_ENDPOINT: string;
      BACKEND_TABLE_NAME: string;
    }
  }
}

export {};
