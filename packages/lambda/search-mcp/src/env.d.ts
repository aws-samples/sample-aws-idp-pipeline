declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BACKEND_URL_SSM_KEY: string;
      DOCUMENT_STORAGE_BUCKET: string;
    }
  }
}

export {};
