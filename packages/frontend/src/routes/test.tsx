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
    <div style={{ padding: '20px' }}>
      <h1>API Test</h1>

      <section style={{ marginBottom: '20px' }}>
        <h2>Tables</h2>
        <button onClick={handleGetTables} disabled={loading}>
          {loading ? 'Loading...' : 'Load Tables'}
        </button>
        <table
          style={{
            marginTop: '10px',
            borderCollapse: 'collapse',
            width: '100%',
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  border: '1px solid #ccc',
                  padding: '8px',
                  textAlign: 'left',
                }}
              >
                Table Name
              </th>
            </tr>
          </thead>
          <tbody>
            {tables.length === 0 ? (
              <tr>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>
                  No tables loaded
                </td>
              </tr>
            ) : (
              tables.map((table) => (
                <tr key={table}>
                  <td style={{ border: '1px solid #ccc', padding: '8px' }}>
                    {table}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
