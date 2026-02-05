import { useCallback, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AwsClient } from 'aws4fetch';
import { useRuntimeConfig } from './useRuntimeConfig';

const CREDENTIAL_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const MIME_TYPES: Record<string, string> = {
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  // Image
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  webp: 'image/webp',
  // Document
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

const getMimeType = (file: File): string => {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return (ext && MIME_TYPES[ext]) || 'application/octet-stream';
};

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export interface StreamEvent {
  type:
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'complete'
    | 'stage_start'
    | 'stage_complete';
  content?: string | ToolResultContent[];
  name?: string;
  tool_use_id?: string;
  stage?: string;
  result?: string;
}

export interface ToolResultContent {
  type: string;
  text?: string;
  format?: string;
  source?: string;
  s3_url?: string | null;
  image?: {
    format?: string;
    source?: { bytes?: string };
  };
}

export interface ContentSource {
  base64: string;
}

export interface ImageContent {
  format: string;
  source: ContentSource;
}

export interface DocumentContent {
  format: string;
  name: string;
  source: ContentSource;
}

export interface ContentBlock {
  image?: ImageContent;
  document?: DocumentContent;
  text?: string;
}

/** 스트림 파싱 (JSON 이벤트) */
async function parseStream(
  response: Response,
  onEvent?: (event: StreamEvent) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let result = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // JSON 객체 단위로 파싱
    let startIdx = 0;
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === '{') {
        let braceCount = 1;
        let j = i + 1;
        let inString = false;
        let escape = false;
        while (j < buffer.length && braceCount > 0) {
          const ch = buffer[j];
          if (escape) {
            escape = false;
          } else if (ch === '\\') {
            escape = true;
          } else if (ch === '"') {
            inString = !inString;
          } else if (!inString) {
            if (ch === '{') braceCount++;
            else if (ch === '}') braceCount--;
          }
          j++;
        }
        if (braceCount === 0) {
          const jsonStr = buffer.slice(i, j);
          try {
            const event = JSON.parse(jsonStr) as StreamEvent;
            onEvent?.(event);
            if (
              event.type === 'text' &&
              event.content &&
              typeof event.content === 'string'
            ) {
              result += event.content;
            }
          } catch {
            // JSON 파싱 실패 시 무시
          }
          startIdx = j;
          i = j - 1;
        } else {
          // 불완전한 JSON - 다음 chunk에서 완성될 때까지 버퍼에 유지
          startIdx = i;
          break;
        }
      }
    }
    buffer = buffer.slice(startIdx);
  }

  return result;
}

/** ARN에서 리전 추출 */
function extractRegionFromArn(arn: string): string {
  return arn.split(':')[3];
}

export function useAwsClient() {
  const {
    apis,
    cognitoProps,
    documentStorageBucketName,
    agentRuntimeArn,
    researchAgentRuntimeArn,
    bidiAgentRuntimeArn,
  } = useRuntimeConfig();
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
      if (!user?.id_token) throw new Error('User token not available');

      const client = await createAwsClient('execute-api');
      const headers = new Headers(options?.headers);
      headers.set('X-User-Id', user.profile?.['cognito:username'] as string);

      const response = await client.fetch(`${apis.Backend}${path}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return response.json();
    },
    [apis, createAwsClient, user],
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
          ContentType: getMimeType(file),
        }),
      );
    },
    [cognitoProps, documentStorageBucketName, getCredentials],
  );

  /** Bedrock Agent 호출 (스트리밍 지원) */
  const invokeAgent = useCallback(
    async (
      prompt: ContentBlock[],
      sessionId: string,
      projectId: string,
      onEvent?: (event: StreamEvent) => void,
      agentId?: string,
      runtimeArn?: string,
    ): Promise<string> => {
      const targetArn = runtimeArn || agentRuntimeArn;
      if (!targetArn) throw new Error('Agent runtime ARN not available');
      if (!user?.id_token) throw new Error('User token not available');

      const region = extractRegionFromArn(targetArn);
      const client = await createAwsClient('bedrock-agentcore', region);

      const response = await client.fetch(
        `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(targetArn)}/invocations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
          },
          body: JSON.stringify({
            prompt,
            session_id: sessionId,
            project_id: projectId,
            user_id: user.profile?.['cognito:username'] as string,
            agent_id: agentId,
          }),
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
        return parseStream(response, onEvent);
      }

      return JSON.stringify(await response.json());
    },
    [agentRuntimeArn, createAwsClient, user],
  );

  /** S3 presigned download URL 생성 */
  const getPresignedDownloadUrl = useCallback(
    async (bucket: string, key: string, expiresIn = 3600): Promise<string> => {
      if (!cognitoProps) throw new Error('Cognito props not available');

      const credentials = await getCredentials();

      const s3Client = new S3Client({
        region: cognitoProps.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      return getSignedUrl(s3Client, command, { expiresIn });
    },
    [cognitoProps, getCredentials],
  );

  return {
    fetchApi,
    uploadToS3,
    invokeAgent,
    getPresignedDownloadUrl,
    researchAgentRuntimeArn,
    bidiAgentRuntimeArn,
    getCredentials,
    userId: user?.profile?.['cognito:username'] as string | undefined,
  };
}
