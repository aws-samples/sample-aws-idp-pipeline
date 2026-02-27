declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BACKEND_TABLE_NAME: string;
      QA_REGENERATOR_FUNCTION_ARN: string;
    }
  }
}

export {};
