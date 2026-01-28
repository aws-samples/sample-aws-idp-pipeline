import React, { PropsWithChildren, useEffect } from 'react';
import { AuthProvider, AuthProviderProps, useAuth } from 'react-oidc-context';
import { Alert } from '../alert';
import CubeLoader from '../CubeLoader';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';

/**
 * Sets up the Cognito auth.
 *
 * This assumes a runtime-config.json file is present at '/'. In order for Auth to be set up automatically,
 * the runtime-config.json must have the cognitoProps set.
 */
const CognitoAuth: React.FC<PropsWithChildren> = ({ children }) => {
  const { cognitoProps } = useRuntimeConfig();

  if (!cognitoProps) {
    if (import.meta.env.MODE === 'serve-local') {
      // In serve-local mode with no cognitoProps available, we skip login
      return <AuthProvider>{children}</AuthProvider>;
    }
    return (
      <Alert type="error" header="Runtime config configuration error">
        <p>
          The cognitoProps have not been configured in the runtime-config.json.
        </p>
      </Alert>
    );
  }

  const cognitoAuthConfig: AuthProviderProps = {
    authority: `https://cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`,
    client_id: cognitoProps.userPoolWebClientId,
    redirect_uri: window.location.origin,
    response_type: 'code',
    scope: 'email openid profile',
  };

  return (
    <AuthProvider {...cognitoAuthConfig}>
      <CognitoAuthInternal>{children}</CognitoAuthInternal>
    </AuthProvider>
  );
};

const CognitoAuthInternal: React.FC<PropsWithChildren> = ({ children }) => {
  const auth = useAuth();

  useEffect(() => {
    if (!auth.isAuthenticated && !auth.isLoading) {
      auth.signinRedirect();
    }
  }, [auth]);

  // Handle authentication errors (e.g., token refresh failure)
  useEffect(() => {
    if (auth.error) {
      console.error('Auth error:', auth.error);
      // Clear any stale auth state and redirect to login
      auth.removeUser().then(() => {
        auth.signinRedirect();
      });
    }
  }, [auth, auth.error]);

  if (auth.isAuthenticated) {
    return children;
  }

  // Show loader while redirecting (including error redirect)
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <CubeLoader />
    </div>
  );
};

export default CognitoAuth;
