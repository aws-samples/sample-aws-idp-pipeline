import { useCallback, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { AwsClient } from 'aws4fetch';
import { useRuntimeConfig } from './useRuntimeConfig';

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5분 전에 갱신

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export function useAwsClient() {
  const { apis, cognitoProps } = useRuntimeConfig();
  const { user } = useAuth();
  const credentialsRef = useRef<Credentials | null>(null);

  const fetchApi = useCallback(
    async <T>(path: string, options?: RequestInit): Promise<T> => {
      if (!cognitoProps || !user?.id_token) {
        throw new Error('Cognito props or user token not available');
      }
      if (!apis?.Backend) {
        throw new Error('Backend API URL not available');
      }

      const now = Date.now();
      const cached = credentialsRef.current;

      let credentials: Credentials;
      if (
        cached?.expiration &&
        cached.expiration.getTime() - now > REFRESH_BUFFER_MS
      ) {
        credentials = cached;
      } else {
        credentials = await fromCognitoIdentityPool({
          clientConfig: { region: cognitoProps.region },
          identityPoolId: cognitoProps.identityPoolId,
          logins: {
            [`cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`]:
              user.id_token,
          },
        })();
        credentialsRef.current = credentials;
      }

      const client = new AwsClient({
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        region: cognitoProps.region,
        service: 'execute-api',
      });

      const response = await client.fetch(`${apis.Backend}${path}`, options);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return response.json();
    },
    [apis, cognitoProps, user],
  );

  return { fetchApi };
}
