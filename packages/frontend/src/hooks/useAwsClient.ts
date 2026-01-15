import { useCallback, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { AwsClient } from 'aws4fetch';
import { useRuntimeConfig } from './useRuntimeConfig';

const CREDENTIAL_REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

/** 스트림 파싱 (plain text) */
async function parseStream(
  response: Response,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    result += chunk;
    onChunk?.(chunk);
  }

  return result;
}

/** ARN에서 리전 추출 */
function extractRegionFromArn(arn: string): string {
  return arn.split(':')[3];
}

export function useAwsClient() {
  const { apis, cognitoProps, documentStorageBucketName, agentRuntimeArn } =
    useRuntimeConfig();
  const { user } = useAuth();
  const credentialsRef = useRef<Credentials | null>(null);
  const pendingRef = useRef<Promise<Credentials> | null>(null);

  /** Cognito Identity Pool에서 AWS 자격 증명 획득 */
  const getCredentials = useCallback(async (): Promise<Credentials> => {
    if (!cognitoProps || !user?.id_token) {
      throw new Error('Cognito props or user token not available');
    }

    const cached = credentialsRef.current;
    const isValid =
      cached?.expiration &&
      cached.expiration.getTime() - Date.now() > CREDENTIAL_REFRESH_BUFFER_MS;

    if (isValid) return cached;

    if (pendingRef.current) return pendingRef.current;

    pendingRef.current = fromCognitoIdentityPool({
      clientConfig: { region: cognitoProps.region },
      identityPoolId: cognitoProps.identityPoolId,
      logins: {
        [`cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`]:
          user.id_token,
      },
    })()
      .then((credentials) => {
        credentialsRef.current = credentials;
        return credentials;
      })
      .finally(() => {
        pendingRef.current = null;
      });

    return pendingRef.current;
  }, [cognitoProps, user]);

  /** SigV4 서명된 AWS 클라이언트 생성 */
  const createAwsClient = useCallback(
    async (service: string, region?: string) => {
      if (!cognitoProps) throw new Error('Cognito props not available');

      const credentials = await getCredentials();
      return new AwsClient({
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        region: region ?? cognitoProps.region,
        service,
      });
    },
    [cognitoProps, getCredentials],
  );

  /** Backend API 호출 */
  const fetchApi = useCallback(
    async <T>(path: string, options?: RequestInit): Promise<T> => {
      if (!apis?.Backend) throw new Error('Backend API URL not available');

      const client = await createAwsClient('execute-api');
      const response = await client.fetch(`${apis.Backend}${path}`, options);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return response.json();
    },
    [apis, createAwsClient],
  );

  /** S3 파일 업로드 */
  const uploadToS3 = useCallback(
    async (file: File, key: string): Promise<void> => {
      if (!cognitoProps) throw new Error('Cognito props not available');
      if (!documentStorageBucketName) {
        throw new Error('Document storage bucket name not available');
      }

      const credentials = await getCredentials();

      const s3Client = new S3Client({
        region: cognitoProps.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      await s3Client.send(
        new PutObjectCommand({
          Bucket: documentStorageBucketName,
          Key: key,
          Body: new Uint8Array(await file.arrayBuffer()),
          ContentType: file.type,
        }),
      );
    },
    [cognitoProps, documentStorageBucketName, getCredentials],
  );

  /** Bedrock Agent 호출 (스트리밍 지원) */
  const invokeAgent = useCallback(
    async (
      prompt: string,
      sessionId: string,
      onChunk?: (chunk: string) => void,
    ): Promise<string> => {
      if (!agentRuntimeArn) throw new Error('Agent runtime ARN not available');

      const region = extractRegionFromArn(agentRuntimeArn);
      const client = await createAwsClient('bedrock-agentcore', region);

      const response = await client.fetch(
        `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(agentRuntimeArn)}/invocations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
          },
          body: JSON.stringify({ prompt, session_id: sessionId }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Agent error: ${response.status} - ${errorText}`);
      }

      const isStreaming = response.headers
        .get('content-type')
        ?.includes('text/event-stream');

      if (isStreaming) {
        return parseStream(response, onChunk);
      }

      return JSON.stringify(await response.json());
    },
    [agentRuntimeArn, createAwsClient],
  );

  return { fetchApi, uploadToS3, invokeAgent };
}
