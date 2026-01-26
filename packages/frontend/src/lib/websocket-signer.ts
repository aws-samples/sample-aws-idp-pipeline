import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-browser';
import { HttpRequest } from '@smithy/protocol-http';
import { formatUrl } from '@aws-sdk/util-format-url';

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface SignedUrlParams {
  websocketUrl: string;
  credentials: Credentials;
  region: string;
}

/**
 * AWS SigV4 서명된 WebSocket URL 생성
 *
 * API Gateway WebSocket은 Session Token을 서명에 포함하지 않고
 * 서명 후에 쿼리 파라미터로 추가해야 함
 */
export async function createSignedWebSocketUrl({
  websocketUrl,
  credentials,
  region,
}: SignedUrlParams): Promise<string> {
  const url = new URL(websocketUrl);

  const httpRequest = new HttpRequest({
    headers: {
      host: url.hostname,
    },
    hostname: url.hostname,
    path: url.pathname || '/',
    protocol: url.protocol,
    method: 'GET',
  });

  // Session Token을 제외한 credentials로 서명
  const signatureV4 = new SignatureV4({
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      // sessionToken 제외!
    },
    region,
    service: 'execute-api',
    sha256: Sha256,
  });

  const signedHttpRequest = await signatureV4.presign(httpRequest, {
    expiresIn: 300,
  });

  // Session Token이 있으면 서명 후에 query에 추가
  if (credentials.sessionToken && signedHttpRequest.query) {
    (signedHttpRequest.query as Record<string, string>)[
      'X-Amz-Security-Token'
    ] = credentials.sessionToken;
  }

  const signedUrl = formatUrl(signedHttpRequest);
  console.log('Signed WebSocket URL:', signedUrl);

  return signedUrl;
}
