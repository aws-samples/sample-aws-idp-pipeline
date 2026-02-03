import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ChatSession } from '../types/project';

export interface SidebarSessionContextValue {
  sessions: ChatSession[];
  currentSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => Promise<void>;
  onSessionDelete: (sessionId: string) => Promise<void>;
  onNewSession: () => void;
  hasMoreSessions: boolean;
  loadingMoreSessions: boolean;
  onLoadMoreSessions: () => void;
}

interface SidebarSessionState {
  value: SidebarSessionContextValue | null;
  setValue: (v: SidebarSessionContextValue | null) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

const SidebarSessionContext = createContext<SidebarSessionState>({
  value: null,
  setValue: noop,
});

export function SidebarSessionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SidebarSessionContextValue | null>(null);
  return (
    <SidebarSessionContext.Provider value={{ value, setValue }}>
      {children}
    </SidebarSessionContext.Provider>
  );
}

export function useSidebarSessions(): SidebarSessionContextValue | null {
  return useContext(SidebarSessionContext).value;
}

export function useSetSidebarSessions(
  v: SidebarSessionContextValue | null,
): void {
  const { setValue } = useContext(SidebarSessionContext);
  const ref = useRef(v);
  ref.current = v;

  useEffect(() => {
    setValue(ref.current);
    return () => setValue(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setValue(v);
  }, [v, setValue]);
}
