import { useState, useCallback } from 'react';
import type { Project } from '../components/ProjectSettingsModal';

interface UseProjectDataOptions {
  fetchApi: <T>(url: string, init?: RequestInit) => Promise<T>;
  projectId: string;
}

export function useProjectData({ fetchApi, projectId }: UseProjectDataOptions) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProjectSettings, setShowProjectSettings] = useState(false);

  const loadProject = useCallback(async () => {
    try {
      const data = await fetchApi<Project>(`projects/${projectId}`);
      setProject(data);
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  }, [fetchApi, projectId]);

  const handleProjectSave = useCallback(
    async (data: Partial<Project>) => {
      await fetchApi(`projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (project) {
        setProject({ ...project, ...data });
      }
    },
    [fetchApi, projectId, project],
  );

  return {
    project,
    setProject,
    loading,
    setLoading,
    loadProject,
    showProjectSettings,
    setShowProjectSettings,
    handleProjectSave,
  };
}
