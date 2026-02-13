import { useState, useCallback } from 'react';
import type { Agent } from '../types/project';

interface UseAgentsOptions {
  fetchApi: <T>(url: string, init?: RequestInit) => Promise<T>;
  projectId: string;
  onNewSession: () => void;
}

export function useAgents({
  fetchApi,
  projectId,
  onNewSession,
}: UseAgentsOptions) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const data = await fetchApi<Agent[]>(`projects/${projectId}/agents`);
      setAgents(data);
    } catch (error) {
      console.error('Failed to load agents:', error);
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  }, [fetchApi, projectId]);

  const loadAgentDetail = useCallback(
    async (agentId: string): Promise<Agent | null> => {
      try {
        return await fetchApi<Agent>(
          `projects/${projectId}/agents/${encodeURIComponent(agentId)}`,
        );
      } catch (error) {
        console.error('Failed to load agent detail:', error);
        return null;
      }
    },
    [fetchApi, projectId],
  );

  const handleAgentCreate = useCallback(
    async (name: string, content: string) => {
      await fetchApi(`projects/${projectId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      await loadAgents();
    },
    [fetchApi, projectId, loadAgents],
  );

  const handleAgentUpdate = useCallback(
    async (agentId: string, content: string) => {
      const agent = agents.find((a) => a.agent_id === agentId);
      if (!agent) return;

      await fetchApi(
        `projects/${projectId}/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: agent.name, content }),
        },
      );
      await loadAgents();
    },
    [fetchApi, projectId, loadAgents, agents],
  );

  const handleAgentDelete = useCallback(
    async (agentId: string) => {
      await fetchApi(
        `projects/${projectId}/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'DELETE',
        },
      );
      await loadAgents();
      if (selectedAgent?.agent_id === agentId) {
        setSelectedAgent(null);
        onNewSession();
      }
    },
    [fetchApi, projectId, loadAgents, selectedAgent, onNewSession],
  );

  const handleAgentSelect = useCallback(
    (agentName: string | null) => {
      onNewSession();
      if (agentName === null) {
        setSelectedAgent(null);
      } else {
        const agent = agents.find((a) => a.name === agentName);
        setSelectedAgent(agent || null);
      }
    },
    [agents, onNewSession],
  );

  return {
    agents,
    setAgents,
    selectedAgent,
    setSelectedAgent,
    showAgentModal,
    setShowAgentModal,
    loadingAgents,
    loadAgents,
    loadAgentDetail,
    handleAgentCreate,
    handleAgentUpdate,
    handleAgentDelete,
    handleAgentSelect,
  };
}
