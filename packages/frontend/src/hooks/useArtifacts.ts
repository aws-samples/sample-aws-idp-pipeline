import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import type { Artifact, ArtifactsResponse } from '../types/project';
import { useWebSocketMessage } from '../contexts/WebSocketContext';

interface UseArtifactsOptions {
  fetchApi: <T>(url: string, init?: RequestInit) => Promise<T>;
  getPresignedDownloadUrl: (bucket: string, key: string) => Promise<string>;
  projectId: string;
  sidePanelCollapsed: boolean;
  setSidePanelCollapsed: (collapsed: boolean) => void;
}

export function useArtifacts({
  fetchApi,
  getPresignedDownloadUrl,
  projectId,
  sidePanelCollapsed,
  setSidePanelCollapsed,
}: UseArtifactsOptions) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );
  const sidePanelAutoExpandedRef = useRef(false);

  const loadArtifacts = useCallback(async () => {
    try {
      const data = await fetchApi<ArtifactsResponse>(
        `artifacts?project_id=${projectId}`,
      );
      setArtifacts(data.items);
    } catch (error) {
      console.error('Failed to load artifacts:', error);
      setArtifacts([]);
    }
  }, [fetchApi, projectId]);

  const handleArtifactMessage = useCallback(
    (data: {
      event: string;
      artifactId: string;
      artifactFileName: string;
      timestamp: string;
    }) => {
      if (data.event === 'created') {
        loadArtifacts();
      }
    },
    [loadArtifacts],
  );

  useWebSocketMessage('artifacts', handleArtifactMessage);

  const handleArtifactSelect = useCallback(
    (artifactId: string) => {
      const artifact = artifacts.find((a) => a.artifact_id === artifactId);
      if (artifact) {
        if (sidePanelCollapsed) {
          setSidePanelCollapsed(false);
          sidePanelAutoExpandedRef.current = true;
        }
        setSelectedArtifact(artifact);
      }
    },
    [artifacts, sidePanelCollapsed, setSidePanelCollapsed],
  );

  const handleArtifactDelete = useCallback(
    async (artifactId: string) => {
      await fetchApi(`artifacts/${artifactId}`, { method: 'DELETE' });
      setArtifacts((prev) => prev.filter((a) => a.artifact_id !== artifactId));
      if (selectedArtifact?.artifact_id === artifactId) {
        setSelectedArtifact(null);
      }
    },
    [fetchApi, selectedArtifact],
  );

  const handleArtifactDownload = useCallback(
    async (artifact: Artifact) => {
      try {
        const presignedUrl = await getPresignedDownloadUrl(
          artifact.s3_bucket,
          artifact.s3_key,
        );

        const response = await fetch(presignedUrl);

        if (!response.ok) {
          if (response.status === 404 || response.status === 403) {
            showToast(
              'error',
              t(
                'chat.artifactNotFound',
                'File not found. It may have been deleted.',
              ),
            );
            return;
          }
          throw new Error(`Download failed: ${response.status}`);
        }

        const blob = await response.blob();

        if (blob.type.includes('xml')) {
          const text = await blob.text();
          if (text.includes('NoSuchKey')) {
            showToast(
              'error',
              t(
                'chat.artifactNotFound',
                'File not found. It may have been deleted.',
              ),
            );
            return;
          }
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = artifact.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Failed to download artifact:', error);
        showToast('error', t('chat.downloadFailed', 'Download failed'));
      }
    },
    [getPresignedDownloadUrl, showToast, t],
  );

  const handleArtifactViewerClose = useCallback(() => {
    setSelectedArtifact(null);
    if (sidePanelAutoExpandedRef.current) {
      setSidePanelCollapsed(true);
      sidePanelAutoExpandedRef.current = false;
    }
  }, [setSidePanelCollapsed]);

  return {
    artifacts,
    setArtifacts,
    selectedArtifact,
    setSelectedArtifact,
    loadArtifacts,
    handleArtifactSelect,
    handleArtifactDelete,
    handleArtifactDownload,
    handleArtifactViewerClose,
  };
}
