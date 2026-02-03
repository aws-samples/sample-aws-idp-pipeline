import React, {
  createContext,
  PropsWithChildren,
  useEffect,
  useState,
} from 'react';

export interface CognitoProps {
  region: string;
  identityPoolId: string;
  userPoolId: string;
  userPoolWebClientId: string;
}

export interface IRuntimeConfig {
  cognitoProps?: CognitoProps;
  apis?: Record<string, unknown>;
  documentStorageBucketName?: string;
  agentRuntimeArn?: string;
  researchAgentRuntimeArn?: string;
  websocketUrl?: string;
}

/**
 * Context for storing the runtimeConfig.
 */
export const RuntimeConfigContext = createContext<IRuntimeConfig | undefined>(
  undefined,
);

/**
 * Apply any overrides to point to local servers/resources here
 * for the serve-local target
 */
const applyOverrides = (runtimeConfig: IRuntimeConfig) => {
  if (import.meta.env.MODE === 'serve-local') {
    // Add local server urls here
  }
  return runtimeConfig;
};

/**
 * Sets up the runtimeConfig.
 *
 * This assumes a runtime-config.json file is present at '/'.
 */
const RuntimeConfigProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [runtimeConfig, setRuntimeConfig] = useState<
    IRuntimeConfig | undefined
  >();
  useEffect(() => {
    (async () => {
      try {
        setRuntimeConfig(
          applyOverrides(await (await fetch('/runtime-config.json')).json()),
        );
      } catch {
        setRuntimeConfig(applyOverrides({ apis: {} }));
      }
    })();
  }, [setRuntimeConfig]);

  return runtimeConfig ? (
    <RuntimeConfigContext.Provider value={runtimeConfig}>
      {children}
    </RuntimeConfigContext.Provider>
  ) : (
    <div className="flex-1 flex flex-col items-center justify-center h-screen gap-6">
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-3 h-3 rounded-full bg-slate-400"
            style={{
              animation: 'pulse-dot 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
};

export default RuntimeConfigProvider;
