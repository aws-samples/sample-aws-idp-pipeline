import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { useAwsClient, StreamEvent } from '../../hooks/useAwsClient';
import { useWebSocket, WebSocketMessage } from '../../hooks/useWebSocket';
import CubeLoader from '../../components/CubeLoader';
import ProjectSettingsModal, {
  Project,
} from '../../components/ProjectSettingsModal';
import ProjectNavBar from '../../components/ProjectNavBar';
import DocumentsPanel from '../../components/DocumentsPanel';
import ChatPanel from '../../components/ChatPanel';
import WorkflowDetailModal from '../../components/WorkflowDetailModal';
import {
  Document,
  DocumentUploadResponse,
  Workflow,
  WorkflowDetail,
  ChatMessage,
  WorkflowProgress,
} from '../../types/project';

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
  const { fetchApi, invokeAgent } = useAwsClient();
  // AgentCore requires session ID >= 33 chars
  const agentSessionId = useMemo(() => nanoid(33), []);
  const [project, setProject] = useState<Project | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
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
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [workflowProgress, setWorkflowProgress] =
    useState<WorkflowProgress | null>(null);
  const [showUploadArea, setShowUploadArea] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    setWorkflowProgress((prev) => {
      const base = prev || {
        workflowId: message.workflow_id,
        documentId: message.document_id || '',
        fileName: message.file_name || '',
        status: 'in_progress' as const,
        currentStep: '',
        stepMessage: '',
        segmentProgress: null,
        error: null,
      };

      switch (message.event) {
        case 'WORKFLOW_STARTED':
          return {
            ...base,
            workflowId: message.workflow_id,
            documentId: message.document_id || base.documentId,
            fileName: message.file_name || base.fileName,
            status: 'in_progress',
            currentStep: 'Starting...',
            stepMessage: 'Workflow started',
          };
        case 'STEP_START':
          return {
            ...base,
            currentStep: message.step || '',
            stepMessage: message.message || 'Processing...',
          };
        case 'STEP_COMPLETE':
          return {
            ...base,
            stepMessage: message.message || 'Step completed',
          };
        case 'STEP_ERROR':
          return {
            ...base,
            status: 'failed',
            error: message.error || 'Unknown error',
          };
        case 'SEGMENT_PROGRESS':
          return {
            ...base,
            segmentProgress: {
              completed: message.completed || 0,
              total: message.total || 0,
            },
          };
        case 'WORKFLOW_COMPLETE':
          return {
            ...base,
            status: 'completed',
            currentStep: 'Completed',
            stepMessage: message.summary || 'Workflow completed',
          };
        case 'WORKFLOW_ERROR':
          return {
            ...base,
            status: 'failed',
            error: message.error || 'Workflow failed',
          };
        default:
          return base;
      }
    });
  }, []);

  const handleWebSocketConnect = useCallback(() => {
    console.log('WebSocket connected for workflow:', activeWorkflowId);
  }, [activeWorkflowId]);

  const handleWebSocketDisconnect = useCallback(() => {
    console.log('WebSocket disconnected');
  }, []);

  const { isConnected } = useWebSocket({
    workflowId: activeWorkflowId,
    onMessage: handleWebSocketMessage,
    onConnect: handleWebSocketConnect,
    onDisconnect: handleWebSocketDisconnect,
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

  const loadChatHistory = useCallback(async () => {
    if (historyLoaded) return;
    try {
      const response = await fetchApi<{
        session_id: string;
        messages: { role: string; content: string }[];
      }>(`chat/projects/${projectId}/sessions/${agentSessionId}`);
      if (response.messages.length > 0) {
        const loadedMessages: ChatMessage[] = response.messages.map(
          (msg, idx) => ({
            id: `history-${idx}`,
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            timestamp: new Date(),
          }),
        );
        setMessages(loadedMessages);
      }
      setHistoryLoaded(true);
    } catch (error) {
      console.error('Failed to load chat history:', error);
      setHistoryLoaded(true);
    }
  }, [fetchApi, agentSessionId, historyLoaded]);

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

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadProject(), loadDocuments(), loadWorkflows()]);
      setLoading(false);
    };
    load();
  }, [loadProject, loadDocuments, loadWorkflows]);

  // Load chat history when page loads
  useEffect(() => {
    loadChatHistory();
  }, [loadChatHistory]);

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
    // Clear active workflow connection after a delay
    const timeout = setTimeout(() => {
      setActiveWorkflowId(null);
      // Keep progress visible for 5 seconds after completion
      setTimeout(() => {
        setWorkflowProgress(null);
      }, 5000);
    }, 1000);
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

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const maxSize = 500 * 1024 * 1024; // 500MB
    const uploadedDocuments: { documentId: string; fileName: string }[] = [];

    setUploading(true);
    setShowUploadArea(false);
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
              setActiveWorkflowId(newWorkflow.workflow_id);
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

  const handleDeleteDocument = async (documentId: string) => {
    if (!window.confirm(t('documents.deleteConfirm'))) return;
    try {
      await fetchApi(`projects/${projectId}/documents/${documentId}`, {
        method: 'DELETE',
      });
      await loadDocuments();
    } catch (error) {
      console.error('Failed to delete document:', error);
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

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setSending(true);
    setStreamingContent('');
    setCurrentToolUse(null);

    try {
      const response = await invokeAgent(
        [{ text: userMessage.content }],
        agentSessionId,
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
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

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
        isConnected={isConnected}
        onSettingsClick={() => setShowProjectSettings(true)}
      />

      {/* Main Content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Documents Panel - 1/3 */}
        <DocumentsPanel
          documents={documents}
          workflows={workflows}
          workflowProgress={workflowProgress}
          uploading={uploading}
          showUploadArea={showUploadArea}
          isDragging={isDragging}
          isConnected={isConnected}
          onToggleUploadArea={() => setShowUploadArea(!showUploadArea)}
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

        {/* Chat Panel - 2/3 */}
        <ChatPanel
          messages={messages}
          inputMessage={inputMessage}
          sending={sending}
          streamingContent={streamingContent}
          currentToolUse={currentToolUse}
          onInputChange={setInputMessage}
          onSendMessage={handleSendMessage}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Workflow Detail Modal */}
      {selectedWorkflow && (
        <WorkflowDetailModal
          workflow={selectedWorkflow}
          projectColor={project?.color ?? 0}
          loadingWorkflow={loadingWorkflow}
          onClose={() => setSelectedWorkflow(null)}
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
              name: data.name,
              description: data.description,
              language: data.language,
              color: data.color,
            });
          }
        }}
      />
    </div>
  );
}
