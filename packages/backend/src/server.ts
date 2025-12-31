import app from './app.js';
import { serve } from '@hono/node-server';
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { SSM_KEYS } from ':idp-v2/common-constructs';

// the stack will be deployed in us-east-1
console.log(`Set AWS_REGION to us-east-1`);
process.env.AWS_REGION = 'us-east-1';

const ssmClient = new SSMClient({ region: 'us-east-1' });

const ssmKeyToEnvVar: Record<string, string> = {
  [SSM_KEYS.LANCEDB_STORAGE_BUCKET_NAME]: 'LANCEDB_STORAGE_BUCKET_NAME',
  [SSM_KEYS.LANCEDB_LOCK_TABLE_NAME]: 'LANCEDB_LOCK_TABLE_NAME',
  [SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME]: 'DOCUMENT_STORAGE_BUCKET_NAME',
  [SSM_KEYS.BACKEND_TABLE_NAME]: 'BACKEND_TABLE_NAME',
};

async function loadSsmParameters() {
  const command = new GetParametersCommand({
    Names: Object.keys(ssmKeyToEnvVar),
  });

  const response = await ssmClient.send(command);

  for (const param of response.Parameters ?? []) {
    const envVar = ssmKeyToEnvVar[param.Name!];
    if (envVar && param.Value) {
      process.env[envVar] = param.Value;
      console.log(`Loaded ${envVar} from SSM`);
    }
  }
}

await loadSsmParameters();

console.log(`Listening on port 3000`);

serve(app);
