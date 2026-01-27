declare global {
  namespace NodeJS {
    interface ProcessEnv {
      ELASTICACHE_ENDPOINT: string;
    }
  }
}

export {};
