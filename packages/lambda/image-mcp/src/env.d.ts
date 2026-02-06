declare global {
  namespace NodeJS {
    interface ProcessEnv {
      AGENT_STORAGE_BUCKET: string;
      UNSPLASH_ACCESS_KEY_PARAM: string;
    }
  }
}

export {};
