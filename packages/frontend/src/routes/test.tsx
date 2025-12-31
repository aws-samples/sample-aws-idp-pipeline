import { createFileRoute } from '@tanstack/react-router';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { useAuth } from 'react-oidc-context';
import { useCallback, useState } from 'react';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { AwsClient } from 'aws4fetch';

export const Route = createFileRoute('/test')({
  component: RouteComponent,
});

function RouteComponent() {
  const { apis, cognitoProps } = useRuntimeConfig();
  const { user } = useAuth();
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleGetTables = useCallback(async () => {
    if (!cognitoProps || !user?.id_token) return;

    setLoading(true);

    const credentials = await fromCognitoIdentityPool({
      clientConfig: { region: cognitoProps.region },
      identityPoolId: cognitoProps.identityPoolId,
      logins: {
        [`cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`]:
          user.id_token,
      },
    })();

    const client = new AwsClient({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      region: cognitoProps.region,
      service: 'execute-api',
    });

    const response = await client.fetch(`${apis?.Backend}tables`);
    const data: string[] = await response.json();
    setTables(data);
    setLoading(false);
  }, [apis, cognitoProps, user]);

  return (
    <>
      <h1>Test</h1>
      <button onClick={handleGetTables} disabled={loading}>
        {loading ? 'Loading...' : 'Get Tables'}
      </button>
      {tables.length > 0 && (
        <ul>
          {tables.map((table) => (
            <li key={table}>{table}</li>
          ))}
        </ul>
      )}
    </>
  );
}
