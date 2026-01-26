import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-browser';
import { HttpRequest } from '@smithy/protocol-http';

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
 * WebSocket은 HTTP 업그레이드 요청이므로 GET 메서드로 서명
 * 브라우저 WebSocket은 헤더를 지원하지 않아 쿼리 스트링 방식 사용
 */
export async function createSignedWebSocketUrl({
  websocketUrl,
  credentials,
  region,
}: SignedUrlParams): Promise<string> {
  const url = new URL(websocketUrl);

  const signer = new SignatureV4({
    credentials,
    region,
    service: 'execute-api',
    sha256: Sha256,
  });

  const request = new HttpRequest({
    method: 'GET',
    protocol: 'wss:',
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      host: url.hostname,
    },
  });

  const signedRequest = await signer.presign(request, {
    expiresIn: 300, // 5분
  });

  // 서명된 쿼리 파라미터로 URL 생성
  const signedUrl = new URL(websocketUrl);
  if (signedRequest.query) {
    for (const [key, value] of Object.entries(signedRequest.query)) {
      signedUrl.searchParams.set(key, value as string);
    }
  }

  return signedUrl.toString();
}
