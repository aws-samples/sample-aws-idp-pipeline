import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import {
  useAwsClient,
  StreamEvent,
  ContentBlock,
} from '../../hooks/useAwsClient';
import { useToast } from '../../components/Toast';
import { useWebSocketMessage } from '../../contexts/WebSocketContext';
import CubeLoader from '../../components/CubeLoader';
import ConfirmModal from '../../components/ConfirmModal';
import ProjectSettingsModal, {
  Project,
} from '../../components/ProjectSettingsModal';
import ProjectNavBar from '../../components/ProjectNavBar';
import DocumentsPanel from '../../components/DocumentsPanel';
import ChatPanel, { AttachedFile } from '../../components/ChatPanel';
import SidePanel from '../../components/SidePanel';
import WorkflowDetailModal from '../../components/WorkflowDetailModal';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '../../components/ui/resizable';
import {
  Document,
  DocumentUploadResponse,
  Workflow,
  WorkflowDetail,
  ChatMessage,
  ChatAttachment,
  ChatSession,
  WorkflowProgress,
  Agent,
  Artifact,
  ArtifactsResponse,
} from '../../types/project';
import AgentSelectModal from '../../components/AgentSelectModal';
import DocumentUploadModal from '../../components/DocumentUploadModal';
import ArtifactViewer from '../../components/ArtifactViewer';

interface DocumentWorkflows {
  document_id: string;
  document_name: string;
  workflows: {
    workflow_id: string;
    status: string;
    file_name: string;
    file_uri: string;
    language: string | null;
    created_at: string;
    updated_at: string;
  }[];
}

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { fetchApi, invokeAgent, getPresignedDownloadUrl } = useAwsClient();
  const { showToast } = useToast();
  // AgentCore requires session ID >= 33 chars
  const [currentSessionId, setCurrentSessionId] = useState(() => nanoid(33));
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsNextCursor, setSessionsNextCursor] = useState<string | null>(
    null,
  );
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentToolUse, setCurrentToolUse] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowDetail | null>(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [workflowProgress, setWorkflowProgress] =
    useState<WorkflowProgress | null>(null);
  const [showUploadArea, setShowUploadArea] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WebSocket 메시지 구독 예시
  useWebSocketMessage<{ message: string }>('sessions', (data) => {
    console.log('WebSocket message received:', data);
  });

  const loadProject = useCallback(async () => {
    try {
      const data = await fetchApi<Project>(`projects/${projectId}`);
      setProject(data);
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  }, [fetchApi, projectId]);

  const loadDocuments = useCallback(async () => {
    try {
      const data = await fetchApi<Document[]>(
        `projects/${projectId}/documents`,
      );
      setDocuments(data);
    } catch (error) {
      console.error('Failed to load documents:', error);
      setDocuments([]);
    }
  }, [fetchApi, projectId]);

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await fetchApi<DocumentWorkflows[]>(
        `projects/${projectId}/workflows`,
      );
      const allWorkflows: Workflow[] = data.flatMap((doc) =>
        doc.workflows.map((wf) => ({
          ...wf,
          document_id: doc.document_id,
        })),
      );
      setWorkflows(allWorkflows);
    } catch (error) {
      console.error('Failed to load workflows:', error);
      setWorkflows([]);
    }
  }, [fetchApi, projectId]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchApi<{
        sessions: ChatSession[];
        next_cursor: string | null;
      }>(`chat/projects/${projectId}/sessions`);
      setSessions(
        data.sessions.sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ),
      );
      setSessionsNextCursor(data.next_cursor);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setSessions([]);
      setSessionsNextCursor(null);
    }
  }, [fetchApi, projectId]);

  const handleNewSession = useCallback(() => {
    const newSessionId = nanoid(33);
    setCurrentSessionId(newSessionId);
    setMessages([]);
  }, []);

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

  const loadAgentDetail = useCallback(
    async (agentName: string): Promise<Agent | null> => {
      try {
        return await fetchApi<Agent>(
          `projects/${projectId}/agents/${encodeURIComponent(agentName)}`,
        );
      } catch (error) {
        console.error('Failed to load agent detail:', error);
        return null;
      }
    },
    [fetchApi, projectId],
  );

  const handleAgentUpsert = useCallback(
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

  const handleAgentDelete = useCallback(
    async (name: string) => {
      await fetchApi(
        `projects/${projectId}/agents/${encodeURIComponent(name)}`,
        {
          method: 'DELETE',
        },
      );
      await loadAgents();
      // Reset to default if deleted agent was selected
      if (selectedAgent?.name === name) {
        setSelectedAgent(null);
        handleNewSession();
      }
    },
    [fetchApi, projectId, loadAgents, selectedAgent, handleNewSession],
  );

  const handleAgentSelect = useCallback(
    (agentName: string | null) => {
      if (agentName === null) {
        setSelectedAgent(null);
      } else {
        const agent = agents.find((a) => a.name === agentName);
        setSelectedAgent(agent || null);
      }
      // Start new session when agent changes
      handleNewSession();
    },
    [agents, handleNewSession],
  );

  const loadMoreSessions = useCallback(async () => {
    if (!sessionsNextCursor || loadingMoreSessions) return;

    setLoadingMoreSessions(true);
    try {
      const data = await fetchApi<{
        sessions: ChatSession[];
        next_cursor: string | null;
      }>(`chat/projects/${projectId}/sessions?cursor=${sessionsNextCursor}`);

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.session_id));
        const newSessions = data.sessions.filter(
          (s) => !existingIds.has(s.session_id),
        );
        return [...prev, ...newSessions].sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );
      });
      setSessionsNextCursor(data.next_cursor);
    } catch (error) {
      console.error('Failed to load more sessions:', error);
    } finally {
      setLoadingMoreSessions(false);
    }
  }, [fetchApi, projectId, sessionsNextCursor, loadingMoreSessions]);

  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      setCurrentSessionId(sessionId);
      setMessages([]);
      setLoadingHistory(true);
      try {
        const response = await fetchApi<{
          session_id: string;
          messages: {
            role: string;
            content: {
              type: string;
              text?: string;
              format?: string;
              source?: string;
              s3_url?: string | null;
              name?: string;
              // For tool_result type
              content?: {
                type: string;
                text?: string;
                format?: string;
                source?: string;
                s3_url?: string | null;
              }[];
            }[];
          }[];
        }>(`chat/projects/${projectId}/sessions/${sessionId}`);

        if (response.messages.length === 0) {
          showToast(
            'warning',
            t('chat.emptySession', 'This session has no messages'),
          );
          setCurrentSessionId(nanoid(33));
        } else {
          const loadedMessages: ChatMessage[] = response.messages.map(
            (msg, idx) => {
              // Check if this is a tool_result message
              const toolResultItem = msg.content.find(
                (item) => item.type === 'tool_result',
              );

              if (toolResultItem && toolResultItem.content) {
                // Handle tool_result - show as assistant message
                const nestedContent = toolResultItem.content;

                // Extract text from nested content
                const textContent = nestedContent
                  .filter((item) => item.type === 'text' && item.text)
                  .map((item) => item.text)
                  .join('\n');

                // Check if this is an artifact result (JSON with artifact_id)
                let artifact = undefined;
                let toolResultType: 'image' | 'artifact' | 'text' = 'text';

                try {
                  const parsed = JSON.parse(textContent);
                  if (parsed.artifact_id && parsed.filename && parsed.url) {
                    artifact = {
                      artifact_id: parsed.artifact_id,
                      filename: parsed.filename,
                      url: parsed.url,
                      s3_key: parsed.s3_key,
                      created_at: parsed.created_at,
                    };
                    toolResultType = 'artifact';
                  }
                } catch {
                  // Not JSON, continue with normal processing
                }

                // Extract images from nested content
                const imageAttachments: ChatAttachment[] = nestedContent
                  .filter(
                    (item) =>
                      item.type === 'image' && (item.s3_url || item.source),
                  )
                  .map((item, imgIdx) => ({
                    id: `history-${idx}-tool-img-${imgIdx}`,
                    type: 'image' as const,
                    name: `generated-${imgIdx + 1}.${item.format || 'png'}`,
                    preview: item.s3_url
                      ? item.s3_url
                      : `data:image/${item.format || 'png'};base64,${item.source}`,
                  }));

                if (imageAttachments.length > 0) {
                  toolResultType = 'image';
                }

                return {
                  id: `history-${idx}`,
                  role: 'assistant' as const,
                  content: toolResultType === 'artifact' ? '' : textContent,
                  attachments:
                    imageAttachments.length > 0 ? imageAttachments : undefined,
                  timestamp: new Date(),
                  isToolResult: true,
                  toolResultType,
                  artifact,
                };
              }

              // Extract text content
              const textContent = msg.content
                .filter((item) => item.type === 'text' && item.text)
                .map((item) => item.text)
                .join('\n');

              // Extract image attachments
              const imageAttachments: ChatAttachment[] = msg.content
                .filter(
                  (item) =>
                    item.type === 'image' && (item.s3_url || item.source),
                )
                .map((item, imgIdx) => ({
                  id: `history-${idx}-img-${imgIdx}`,
                  type: 'image' as const,
                  name: `image-${imgIdx + 1}.${item.format || 'png'}`,
                  preview: item.s3_url
                    ? item.s3_url
                    : `data:image/${item.format || 'png'};base64,${item.source}`,
                }));

              // Extract document attachments
              const documentAttachments: ChatAttachment[] = msg.content
                .filter((item) => item.type === 'document' && item.name)
                .map((item, docIdx) => {
                  const baseName = item.name || `document-${docIdx + 1}`;
                  // If name doesn't have an extension, append format
                  const hasExtension = /\.[a-zA-Z0-9]+$/.test(baseName);
                  const finalName =
                    hasExtension || !item.format
                      ? baseName
                      : `${baseName}.${item.format}`;
                  return {
                    id: `history-${idx}-doc-${docIdx}`,
                    type: 'document' as const,
                    name: finalName,
                    preview: null,
                  };
                });

              const allAttachments = [
                ...imageAttachments,
                ...documentAttachments,
              ];

              return {
                id: `history-${idx}`,
                role: msg.role as 'user' | 'assistant',
                content: textContent,
                attachments:
                  allAttachments.length > 0 ? allAttachments : undefined,
                timestamp: new Date(),
              };
            },
          );
          setMessages(loadedMessages);
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
        showToast('error', t('chat.loadError', 'Failed to load conversation'));
        setCurrentSessionId(nanoid(33));
      } finally {
        setLoadingHistory(false);
      }
    },
    [fetchApi, projectId, showToast, t],
  );

  const handleSessionRename = useCallback(
    async (sessionId: string, newName: string) => {
      await fetchApi(`chat/projects/${projectId}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_name: newName }),
      });
      // Update local state
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === sessionId ? { ...s, session_name: newName } : s,
        ),
      );
    },
    [fetchApi, projectId],
  );

  const handleSessionDelete = useCallback(
    async (sessionId: string) => {
      await fetchApi(`chat/projects/${projectId}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      // Remove from local state
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      // If deleted session was current, start new conversation
      if (sessionId === currentSessionId) {
        setCurrentSessionId(nanoid(33));
        setMessages([]);
      }
    },
    [fetchApi, projectId, currentSessionId],
  );

  const handleArtifactDelete = useCallback(
    async (artifactId: string) => {
      await fetchApi(`artifacts/${artifactId}`, {
        method: 'DELETE',
      });
      setArtifacts((prev) => prev.filter((a) => a.artifact_id !== artifactId));
      // Close viewer if deleted artifact was being viewed
      if (selectedArtifact?.artifact_id === artifactId) {
        setSelectedArtifact(null);
      }
    },
    [fetchApi, selectedArtifact],
  );

  const handleArtifactSelect = useCallback(
    (artifactId: string) => {
      const artifact = artifacts.find((a) => a.artifact_id === artifactId);
      if (artifact) {
        setSelectedArtifact(artifact);
      }
    },
    [artifacts],
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

  const loadWorkflowDetail = async (documentId: string, workflowId: string) => {
    setLoadingWorkflow(true);
    try {
      const data = await fetchApi<WorkflowDetail>(
        `documents/${documentId}/workflows/${workflowId}`,
      );
      setSelectedWorkflow(data);
    } catch (error) {
      console.error('Failed to load workflow detail:', error);
    }
    setLoadingWorkflow(false);
  };

  const handleReanalyze = useCallback(
    async (userInstructions: string) => {
      if (!selectedWorkflow) return;

      setReanalyzing(true);
      try {
        await fetchApi<{
          workflow_id: string;
          execution_arn: string;
          status: string;
        }>(
          `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/reanalyze`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_instructions: userInstructions }),
          },
        );
        showToast('success', t('workflow.reanalyzeStarted'));
        setSelectedWorkflow(null);
        // Refresh workflows list
        loadWorkflows();
      } catch (error) {
        console.error('Failed to start re-analysis:', error);
        showToast('error', t('workflow.reanalyzeFailed'));
      } finally {
        setReanalyzing(false);
      }
    },
    [fetchApi, selectedWorkflow, showToast, t, loadWorkflows],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([
        loadProject(),
        loadDocuments(),
        loadWorkflows(),
        loadSessions(),
        loadAgents(),
        loadArtifacts(),
      ]);
      setLoading(false);
    };
    load();
  }, [
    loadProject,
    loadDocuments,
    loadWorkflows,
    loadSessions,
    loadAgents,
    loadArtifacts,
  ]);

  // Handle workflow completion/failure
  const progressStatus = workflowProgress?.status;
  useEffect(() => {
    if (
      !progressStatus ||
      (progressStatus !== 'completed' && progressStatus !== 'failed')
    ) {
      return;
    }
    // Refresh workflows list
    loadWorkflows();
    // Clear workflow progress after a delay
    const timeout = setTimeout(() => {
      setWorkflowProgress(null);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [progressStatus, loadWorkflows]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the drop zone entirely
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    await processFiles(Array.from(files));
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    await processFiles(Array.from(files));
  };

  const processFiles = async (files: File[], useBda = false) => {
    if (files.length === 0) return;

    const maxSize = 500 * 1024 * 1024; // 500MB
    const uploadedDocuments: { documentId: string; fileName: string }[] = [];

    setUploading(true);
    setShowUploadArea(false);
    setShowUploadModal(false);
    try {
      for (const file of Array.from(files)) {
        // Check file size
        if (file.size > maxSize) {
          console.error(`File ${file.name} exceeds 500MB limit`);
          continue;
        }

        // Step 1: Request presigned URL from backend
        const uploadInfo = await fetchApi<DocumentUploadResponse>(
          `projects/${projectId}/documents`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file_name: file.name,
              content_type: file.type || 'application/octet-stream',
              file_size: file.size,
              use_bda: useBda,
            }),
          },
        );

        uploadedDocuments.push({
          documentId: uploadInfo.document_id,
          fileName: file.name,
        });

        // Step 2: Upload file directly to S3 using presigned URL
        const uploadResponse = await fetch(uploadInfo.upload_url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload ${file.name} to S3`);
        }

        // Step 3: Update document status to completed
        await fetchApi(
          `projects/${projectId}/documents/${uploadInfo.document_id}/status`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' }),
          },
        );
      }
      await loadDocuments();

      // Initialize progress state for uploaded files
      if (uploadedDocuments.length > 0) {
        const uploadedDocIds = uploadedDocuments.map((d) => d.documentId);
        setWorkflowProgress({
          workflowId: '',
          documentId: uploadedDocuments[0].documentId,
          fileName: uploadedDocuments.map((d) => d.fileName).join(', '),
          status: 'pending',
          currentStep: 'Waiting for workflow...',
          stepMessage: 'Upload complete. Starting analysis...',
          segmentProgress: null,
          error: null,
        });

        // Poll for new workflow after upload
        const pollForWorkflow = async (retries = 10) => {
          for (let i = 0; i < retries; i++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            // Fetch workflows for uploaded documents
            const allWorkflows: Workflow[] = [];
            for (const uploaded of uploadedDocuments) {
              try {
                const docWorkflows = await fetchApi<
                  Omit<Workflow, 'document_id'>[]
                >(`documents/${uploaded.documentId}/workflows`);
                allWorkflows.push(
                  ...docWorkflows.map((wf) => ({
                    ...wf,
                    document_id: uploaded.documentId,
                  })),
                );
              } catch {
                // Skip documents with no workflows yet
              }
            }
            // Find workflow that matches uploaded document and is pending/in_progress
            const newWorkflow = allWorkflows.find(
              (w) =>
                uploadedDocIds.includes(w.document_id) &&
                (w.status === 'pending' || w.status === 'in_progress'),
            );
            if (newWorkflow) {
              setWorkflowProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      workflowId: newWorkflow.workflow_id,
                      documentId: newWorkflow.document_id,
                      status: 'in_progress',
                      currentStep: 'Connected',
                      stepMessage: 'Workflow started',
                    }
                  : null,
              );
              setWorkflows((prevWorkflows) => {
                const existingIds = new Set(
                  prevWorkflows.map((w) => w.workflow_id),
                );
                const newWorkflows = allWorkflows.filter(
                  (w) => !existingIds.has(w.workflow_id),
                );
                return [...prevWorkflows, ...newWorkflows];
              });
              return;
            }
          }
          // If no workflow found after retries, clear progress
          setWorkflowProgress(null);
        };
        pollForWorkflow();
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
      setWorkflowProgress(null);
    }
    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteDocument = (documentId: string) => {
    const doc = documents.find((d) => d.document_id === documentId);
    if (doc) {
      setDeleteTarget(doc);
    }
  };

  const confirmDeleteDocument = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetchApi(
        `projects/${projectId}/documents/${deleteTarget.document_id}`,
        {
          method: 'DELETE',
        },
      );
      await loadDocuments();
      setDeleteTarget(null);
    } catch (error) {
      console.error('Failed to delete document:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'text':
        if (event.content) {
          setStreamingContent((prev) => prev + event.content);
        }
        break;
      case 'tool_use':
        setCurrentToolUse(event.name ?? null);
        break;
      case 'complete':
        setCurrentToolUse(null);
        break;
    }
  }, []);

  const handleSendMessage = useCallback(
    async (files: AttachedFile[]) => {
      if ((!inputMessage.trim() && files.length === 0) || sending) return;

      // Convert AttachedFile to ChatAttachment for display
      const attachments: ChatAttachment[] = files.map((f) => ({
        id: f.id,
        type: f.type === 'image' ? 'image' : 'document',
        name: f.file.name,
        preview: f.preview,
      }));

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: inputMessage.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputMessage('');
      setSending(true);
      setStreamingContent('');
      setCurrentToolUse(null);

      try {
        // Convert files to ContentBlock[]
        const contentBlocks: ContentBlock[] = [];

        // Track document names to ensure uniqueness (Bedrock requires unique names)
        const usedDocNames = new Set<string>();
        const getUniqueDocName = (originalName: string): string => {
          let name = originalName;
          let counter = 1;
          while (usedDocNames.has(name)) {
            const dotIndex = originalName.lastIndexOf('.');
            if (dotIndex > 0) {
              name = `${originalName.slice(0, dotIndex)}_${counter}${originalName.slice(dotIndex)}`;
            } else {
              name = `${originalName}_${counter}`;
            }
            counter++;
          }
          usedDocNames.add(name);
          return name;
        };

        // Process attached files
        for (const attachedFile of files) {
          // Use FileReader for reliable base64 encoding
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // Remove data URL prefix (e.g., "data:image/png;base64,")
              const base64Data = result.split(',')[1];
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(attachedFile.file);
          });

          if (attachedFile.type === 'image') {
            // Extract and normalize format (jpeg -> jpg for backend compatibility)
            let format =
              attachedFile.file.type.split('/')[1] ||
              attachedFile.file.name.split('.').pop()?.toLowerCase() ||
              'png';
            if (format === 'jpeg') format = 'jpg';
            contentBlocks.push({
              image: {
                format,
                source: { base64 },
              },
            });
          } else {
            // Document type
            const format =
              attachedFile.file.name.split('.').pop()?.toLowerCase() || 'txt';
            const uniqueName = getUniqueDocName(attachedFile.file.name);
            contentBlocks.push({
              document: {
                format,
                name: uniqueName,
                source: { base64 },
              },
            });
          }
        }

        // Add text message if present
        if (userMessage.content) {
          contentBlocks.push({ text: userMessage.content });
        }

        const response = await invokeAgent(
          contentBlocks,
          currentSessionId,
          projectId,
          handleStreamEvent,
        );

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        console.error('Failed to send message:', error);
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Failed to get response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
      setSending(false);
      setStreamingContent('');
      setCurrentToolUse(null);
      // Refresh sessions list after sending a message
      loadSessions();
    },
    [
      inputMessage,
      sending,
      invokeAgent,
      currentSessionId,
      projectId,
      handleStreamEvent,
      loadSessions,
    ],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <CubeLoader />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-slate-500">{t('projects.notFound')}</div>
        <Link
          to="/"
          className="text-blue-600 hover:text-blue-700 hover:underline"
        >
          {t('projects.backToProjects')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Navigation Bar */}
      <ProjectNavBar
        project={project}
        documentCount={documents.length}
        onSettingsClick={() => setShowProjectSettings(true)}
      />

      {/* Main Content - 3 Column Resizable Layout */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultSize={[28, 47, 25]}
          panels={[
            { id: 'documents', minSize: 15, maxSize: 35, collapsible: true },
            { id: 'chat', minSize: 25, maxSize: 70 },
            { id: 'side', minSize: 15, maxSize: 35, collapsible: true },
          ]}
          className="h-full"
        >
          {/* Left - Documents Panel */}
          <ResizablePanel id="documents">
            <div className="h-full pr-1">
              <DocumentsPanel
                documents={documents}
                workflows={workflows}
                workflowProgress={workflowProgress}
                uploading={uploading}
                showUploadArea={showUploadArea}
                isDragging={isDragging}
                onToggleUploadArea={() => setShowUploadModal(true)}
                onRefresh={loadDocuments}
                onFileUpload={handleFileUpload}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onCloseUploadArea={() => setShowUploadArea(false)}
                onViewWorkflow={loadWorkflowDetail}
                onDeleteDocument={handleDeleteDocument}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle id="documents:chat" />

          {/* Center - Chat Panel */}
          <ResizablePanel id="chat">
            <div className="h-full px-1">
              <ChatPanel
                messages={messages}
                inputMessage={inputMessage}
                sending={sending}
                streamingContent={streamingContent}
                currentToolUse={currentToolUse}
                loadingHistory={loadingHistory}
                selectedAgent={selectedAgent}
                onInputChange={setInputMessage}
                onSendMessage={handleSendMessage}
                onAgentClick={() => setShowAgentModal(true)}
                onNewChat={handleNewSession}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle id="chat:side" />

          {/* Right - History & Artifacts */}
          <ResizablePanel id="side">
            <div className="h-full pl-1 relative">
              <SidePanel
                sessions={sessions}
                currentSessionId={currentSessionId}
                onSessionSelect={handleSessionSelect}
                onSessionRename={handleSessionRename}
                onSessionDelete={handleSessionDelete}
                hasMoreSessions={!!sessionsNextCursor}
                loadingMoreSessions={loadingMoreSessions}
                onLoadMoreSessions={loadMoreSessions}
                artifacts={artifacts}
                currentArtifactId={selectedArtifact?.artifact_id}
                onArtifactSelect={handleArtifactSelect}
                onArtifactDownload={handleArtifactDownload}
                onArtifactDelete={handleArtifactDelete}
              />
              {/* Artifact Viewer - overlays SidePanel */}
              {selectedArtifact && (
                <ArtifactViewer
                  artifact={selectedArtifact}
                  onClose={() => setSelectedArtifact(null)}
                  onDownload={handleArtifactDownload}
                  getPresignedUrl={getPresignedDownloadUrl}
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Workflow Detail Modal */}
      {selectedWorkflow && (
        <WorkflowDetailModal
          workflow={selectedWorkflow}
          projectColor={project?.color ?? 0}
          loadingWorkflow={loadingWorkflow}
          onClose={() => setSelectedWorkflow(null)}
          onReanalyze={handleReanalyze}
          reanalyzing={reanalyzing}
        />
      )}

      {/* Project Settings Modal */}
      <ProjectSettingsModal
        project={project}
        isOpen={showProjectSettings}
        onClose={() => setShowProjectSettings(false)}
        onSave={async (data) => {
          await fetchApi(`projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (project) {
            setProject({
              ...project,
              ...data,
            });
          }
        }}
      />

      {/* Delete Document Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteDocument}
        title={t('documents.deleteConfirm')}
        message={deleteTarget?.name || ''}
        confirmText={t('common.delete')}
        variant="danger"
        loading={deleting}
      />

      {/* Agent Select Modal */}
      <AgentSelectModal
        isOpen={showAgentModal}
        agents={agents}
        selectedAgentName={selectedAgent?.name || null}
        loading={loadingAgents}
        onClose={() => setShowAgentModal(false)}
        onSelect={handleAgentSelect}
        onCreate={handleAgentUpsert}
        onUpdate={handleAgentUpsert}
        onDelete={handleAgentDelete}
        onLoadDetail={loadAgentDetail}
      />

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={showUploadModal}
        uploading={uploading}
        documentPrompt={project?.document_prompt || undefined}
        onClose={() => setShowUploadModal(false)}
        onUpload={processFiles}
      />
    </div>
  );
}
