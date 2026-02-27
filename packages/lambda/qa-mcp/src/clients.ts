import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient());
const lambdaClient = new LambdaClient();

const LANGUAGE_MAP: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
};

interface WorkflowItem {
  PK: string;
  SK: string;
  data: {
    project_id: string;
    file_uri: string;
    file_name: string;
    file_type: string;
    status: string;
    total_segments?: number;
    language?: string;
  };
}

export async function queryWorkflows(
  documentId: string,
): Promise<WorkflowItem[]> {
  const tableName = process.env.BACKEND_TABLE_NAME;
  const workflows: WorkflowItem[] = [];

  for (const prefix of ['DOC', 'WEB']) {
    const result = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `${prefix}#${documentId}`,
          ':sk': 'WF#',
        },
      }),
    );
    workflows.push(...((result.Items as WorkflowItem[]) ?? []));
  }

  return workflows;
}

export function pickLatestWorkflow(
  workflows: WorkflowItem[],
): WorkflowItem | undefined {
  const completed = workflows.filter((w) => w.data.status === 'completed');
  return completed.length > 0
    ? completed[completed.length - 1]
    : workflows[workflows.length - 1];
}

export async function getProjectLanguage(projectId: string): Promise<string> {
  const tableName = process.env.BACKEND_TABLE_NAME;

  const result = await ddbClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `PROJ#${projectId}`, SK: 'META' },
      ProjectionExpression: '#d.#l',
      ExpressionAttributeNames: { '#d': 'data', '#l': 'language' },
    }),
  );

  const lang = (result.Item?.data as { language?: string })?.language ?? 'en';
  return LANGUAGE_MAP[lang] ?? 'English';
}

export async function invokeQaRegenerator(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.QA_REGENERATOR_FUNCTION_ARN,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(payload),
    }),
  );

  if (response.FunctionError) {
    const errorPayload = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : 'Unknown error';
    throw new Error(`QA regenerator Lambda error: ${errorPayload}`);
  }

  const result = response.Payload
    ? JSON.parse(new TextDecoder().decode(response.Payload))
    : {};

  if (result.statusCode && result.statusCode !== 200) {
    throw new Error(result.error ?? 'QA regenerator error');
  }

  return result;
}
