import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { nanoid } from 'nanoid';
import { useAwsClient, StreamEvent } from '../../hooks/useAwsClient';
import { useWebSocket, WebSocketMessage } from '../../hooks/useWebSocket';

interface Project {
  project_id: string;
  name: string;
  description: string;
  status: string;
  language: string | null;
  color: number | null;
  started_at: string;
  ended_at: string | null;
}

const LANGUAGES = [
  { code: 'ko', name: 'Korean', flag: 'KR' },
  { code: 'en', name: 'English', flag: 'EN' },
  { code: 'ja', name: 'Japanese', flag: 'JP' },
  { code: 'zh', name: 'Chinese', flag: 'CN' },
];

interface Document {
  document_id: string;
  name: string;
  file_type: string;
  file_size: number;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface DocumentUploadResponse {
  document_id: string;
  upload_url: string;
  file_name: string;
}

interface Workflow {
  workflow_id: string;
  document_id: string;
  status: string;
  file_name: string;
  file_uri: string;
  language: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowSummary {
  workflow_id: string;
  status: string;
  file_name: string;
  file_uri: string;
  language: string | null;
  created_at: string;
  updated_at: string;
}

interface DocumentWorkflows {
  document_id: string;
  document_name: string;
  workflows: WorkflowSummary[];
}

interface SegmentData {
  segment_index: number;
  segment_type?: 'PAGE' | 'VIDEO' | 'CHAPTER';
  image_uri: string;
  image_url: string | null;
  file_uri?: string;
  video_url?: string | null;
  start_timecode_smpte?: string;
  end_timecode_smpte?: string;
  bda_indexer: string;
  paddleocr: string;
  format_parser: string;
  ai_analysis: {
    analysis_query: string;
    content: string;
  }[];
}

interface WorkflowDetail {
  workflow_id: string;
  document_id: string;
  status: string;
  file_name: string;
  file_uri: string;
  file_type: string;
  language: string | null;
  total_segments: number;
  created_at: string;
  updated_at: string;
  segments: SegmentData[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface WorkflowProgress {
  workflowId: string;
  documentId: string;
  fileName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  currentStep: string;
  stepMessage: string;
  segmentProgress: { completed: number; total: number } | null;
  error: string | null;
}

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const { fetchApi, invokeAgent } = useAwsClient();
  // AgentCore requires session ID >= 33 chars
  const agentSessionId = useMemo(() => `idp-session-${nanoid(21)}`, []);
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
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState(true);
  const [analysisPopup, setAnalysisPopup] = useState<{
    type: 'bda' | 'ai' | null;
    content: string;
    title: string;
    qaItems?: { question: string; answer: string }[];
  }>({ type: null, content: '', title: '' });
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [workflowProgress, setWorkflowProgress] =
    useState<WorkflowProgress | null>(null);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showUploadArea, setShowUploadArea] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);

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
      }>(`chat/sessions/${agentSessionId}/history`);
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
    setCurrentSegmentIndex(0);
    setImageLoading(true);
    setAnalysisPopup({ type: null, content: '', title: '' });
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

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

  // Update analysis popup when segment changes
  useEffect(() => {
    if (!selectedWorkflow || !analysisPopup.type) return;

    const segment = selectedWorkflow.segments[currentSegmentIndex];
    if (!segment) {
      setAnalysisPopup({ type: null, content: '', title: '' });
      return;
    }

    if (analysisPopup.type === 'bda') {
      // Check if it was BDA, OCR, or PDF based on title
      if (analysisPopup.title.includes('PDF')) {
        setAnalysisPopup({
          type: 'bda',
          content: segment.format_parser || '',
          title: `PDF Content - Segment ${currentSegmentIndex + 1}`,
        });
      } else if (analysisPopup.title.includes('OCR')) {
        setAnalysisPopup({
          type: 'bda',
          content: segment.paddleocr || '',
          title: `OCR Content - Segment ${currentSegmentIndex + 1}`,
        });
      } else {
        setAnalysisPopup({
          type: 'bda',
          content: segment.bda_indexer || '',
          title: `BDA Content - Segment ${currentSegmentIndex + 1}`,
        });
      }
    } else if (analysisPopup.type === 'ai') {
      if (segment.ai_analysis?.length > 0) {
        const qaItems = segment.ai_analysis.map((a) => ({
          question: a.analysis_query,
          answer: a.content,
        }));
        setAnalysisPopup({
          type: 'ai',
          content: '',
          title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
          qaItems,
        });
      } else {
        setAnalysisPopup({
          type: 'ai',
          content: '',
          title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
          qaItems: [],
        });
      }
    }
  }, [
    currentSegmentIndex,
    selectedWorkflow,
    analysisPopup.type,
    analysisPopup.title,
  ]);

  // Close language dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setShowLanguageDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageChange = async (newLanguage: string) => {
    if (!project || project.language === newLanguage) {
      setShowLanguageDropdown(false);
      return;
    }

    const langName =
      LANGUAGES.find((l) => l.code === newLanguage)?.name || newLanguage;
    const confirmed = window.confirm(
      `Change project language to ${langName}?\n\nNote: Previously analyzed documents will not be affected. Only future document analyses will use the new language setting.`,
    );

    if (!confirmed) {
      setShowLanguageDropdown(false);
      return;
    }

    try {
      await fetchApi(`projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: newLanguage }),
      });
      setProject({ ...project, language: newLanguage });
      setShowLanguageDropdown(false);
    } catch (error) {
      console.error('Failed to update language:', error);
    }
  };

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
    if (!window.confirm('Are you sure you want to delete this document?'))
      return;
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
        userMessage.content,
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

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) {
      return (
        <svg
          className="h-5 w-5 text-red-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (fileType.includes('image')) {
      return (
        <svg
          className="h-5 w-5 text-green-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    return (
      <svg
        className="h-5 w-5 text-slate-400"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
          clipRule="evenodd"
        />
      </svg>
    );
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      completed: 'bg-green-100 text-green-700',
      processing: 'bg-yellow-100 text-yellow-700',
      failed: 'bg-red-100 text-red-700',
      uploading: 'bg-blue-100 text-blue-700',
    };
    return statusColors[status] || 'bg-slate-100 text-slate-700';
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-slate-500">Loading project...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-slate-500">Project not found</div>
        <Link
          to="/"
          className="text-blue-600 hover:text-blue-700 hover:underline"
        >
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <Link
          to="/"
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title="Back to Projects"
        >
          <svg
            className="h-5 w-5 text-slate-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-800">{project.name}</h1>
            {/* Language Selector */}
            <div className="relative" ref={languageDropdownRef}>
              <button
                onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                title="Project Language"
              >
                <span className="font-medium text-slate-600">
                  {LANGUAGES.find((l) => l.code === (project.language || 'en'))
                    ?.flag || 'EN'}
                </span>
                <svg
                  className={`h-4 w-4 text-slate-500 transition-transform ${showLanguageDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {showLanguageDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2 ${
                        project.language === lang.code
                          ? 'bg-blue-50 text-blue-600'
                          : 'text-slate-700'
                      }`}
                    >
                      <span className="font-medium">{lang.flag}</span>
                      <span>{lang.name}</span>
                      {project.language === lang.code && (
                        <svg
                          className="h-4 w-4 ml-auto"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {project.description && (
            <p className="text-sm text-slate-500 mt-0.5">
              {project.description}
            </p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Documents Panel - 1/3 */}
        <div className="w-1/3 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Documents Header with Toolbar */}
          <div className="p-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowUploadArea(!showUploadArea)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  showUploadArea
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add Document
              </button>
              <button
                onClick={() => loadDocuments()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                title="Refresh documents"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
              <span className="ml-auto text-xs text-slate-500">
                {documents.length} files
              </span>
            </div>
          </div>

          {/* Collapsible Upload Area */}
          {showUploadArea && (
            <div
              className={`border-b border-slate-200 relative transition-colors ${
                isDragging ? 'bg-blue-50' : 'bg-slate-50'
              }`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <button
                onClick={() => setShowUploadArea(false)}
                className="absolute top-3 right-3 p-1.5 hover:bg-slate-200 rounded-lg transition-colors z-10"
                title="Close"
              >
                <svg
                  className="h-4 w-4 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
              <label
                className={`flex flex-col items-center justify-center p-8 cursor-pointer transition-colors ${
                  isDragging ? 'bg-blue-100' : 'hover:bg-slate-100'
                } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg
                  className={`h-12 w-12 mb-3 transition-colors ${
                    isDragging ? 'text-blue-500' : 'text-slate-400'
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p
                  className={`text-sm font-medium mb-1 transition-colors ${
                    isDragging ? 'text-blue-700' : 'text-slate-700'
                  }`}
                >
                  {uploading
                    ? 'Uploading...'
                    : isDragging
                      ? 'Drop files here'
                      : 'Drag and drop files or click to upload'}
                </p>
                <p className="text-xs text-slate-500 text-center leading-relaxed">
                  Supports documents (PDF, DOC, TXT), images (PNG, JPG, GIF,
                  TIFF),
                  <br />
                  videos (MP4, MOV, AVI), and audio files (MP3, WAV, FLAC) up to
                  500MB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.tiff,.mp4,.mov,.avi,.mp3,.wav,.flac"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          )}

          {/* Documents List */}
          <div className="flex-1 overflow-y-auto p-3">
            {documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <svg
                  className="h-16 w-16 text-slate-200 mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-sm font-medium text-slate-500 mb-1">
                  No documents yet
                </p>
                <p className="text-xs text-slate-400">
                  Click "Add Document" to upload files
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => {
                  const workflow = workflows.find(
                    (wf) => wf.document_id === doc.document_id,
                  );
                  const isProcessing =
                    workflowProgress &&
                    workflowProgress.documentId === doc.document_id &&
                    workflowProgress.status !== 'completed' &&
                    workflowProgress.status !== 'failed';
                  const processingComplete =
                    workflowProgress &&
                    workflowProgress.documentId === doc.document_id &&
                    workflowProgress.status === 'completed';
                  const processingFailed =
                    workflowProgress &&
                    workflowProgress.documentId === doc.document_id &&
                    workflowProgress.status === 'failed';

                  return (
                    <div
                      key={doc.document_id}
                      className={`group bg-white border rounded-lg p-3 transition-all ${
                        isProcessing
                          ? 'border-blue-300 bg-blue-50/30'
                          : processingComplete
                            ? 'border-green-300 bg-green-50/30'
                            : processingFailed
                              ? 'border-red-300 bg-red-50/30'
                              : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Document Info Row */}
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex-shrink-0 p-2 rounded-lg ${
                            isProcessing
                              ? 'bg-blue-100'
                              : doc.file_type.includes('image')
                                ? 'bg-purple-100'
                                : 'bg-slate-100'
                          }`}
                        >
                          {getFileIcon(doc.file_type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {doc.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded font-medium ${getStatusBadge(doc.status)}`}
                            >
                              {doc.status}
                            </span>
                            <span className="text-xs text-slate-400">
                              {(doc.file_size / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        {!isProcessing && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {workflow && (
                              <button
                                onClick={() =>
                                  loadWorkflowDetail(
                                    workflow.document_id,
                                    workflow.workflow_id,
                                  )
                                }
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                title="View analysis"
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                  />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                  />
                                </svg>
                                View
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteDocument(doc.document_id);
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete document"
                            >
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Processing Progress */}
                      {(isProcessing ||
                        processingComplete ||
                        processingFailed) &&
                        workflowProgress && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <div className="flex items-center gap-2 mb-1">
                              {processingComplete ? (
                                <svg
                                  className="h-4 w-4 text-green-500"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              ) : processingFailed ? (
                                <svg
                                  className="h-4 w-4 text-red-500"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  className="h-4 w-4 text-blue-500 animate-spin"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                  />
                                </svg>
                              )}
                              <span
                                className={`text-xs font-medium ${
                                  processingComplete
                                    ? 'text-green-700'
                                    : processingFailed
                                      ? 'text-red-700'
                                      : 'text-blue-700'
                                }`}
                              >
                                {workflowProgress.currentStep}
                              </span>
                              {isConnected && isProcessing && (
                                <span className="ml-auto text-xs text-green-600 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                  Live
                                </span>
                              )}
                            </div>
                            <p
                              className={`text-xs ${
                                processingComplete
                                  ? 'text-green-600'
                                  : processingFailed
                                    ? 'text-red-600'
                                    : 'text-blue-600'
                              }`}
                            >
                              {workflowProgress.error ||
                                workflowProgress.stepMessage}
                            </p>
                            {workflowProgress.segmentProgress &&
                              isProcessing && (
                                <div className="mt-2">
                                  <div className="flex justify-between text-xs text-blue-600 mb-1">
                                    <span>Segments</span>
                                    <span>
                                      {
                                        workflowProgress.segmentProgress
                                          .completed
                                      }{' '}
                                      / {workflowProgress.segmentProgress.total}
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                      style={{
                                        width: `${(workflowProgress.segmentProgress.completed / workflowProgress.segmentProgress.total) * 100}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Chat Panel - 2/3 */}
        <div className="w-2/3 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Chat Header */}
          <div className="p-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800">Chat</h2>
            <p className="text-sm text-slate-500">
              Ask questions about your documents
            </p>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <svg
                  className="h-16 w-16 text-slate-200 mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                <p className="text-slate-500 mb-2">Start a conversation</p>
                <p className="text-sm text-slate-400">
                  Upload documents and ask questions about them
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                        message.role === 'user'
                          ? 'bg-blue-600'
                          : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      <p
                        className="text-sm whitespace-pre-wrap"
                        style={
                          message.role === 'user'
                            ? { color: 'white' }
                            : undefined
                        }
                      >
                        {message.content}
                      </p>
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 text-slate-800 px-4 py-3 rounded-2xl max-w-[80%]">
                      {currentToolUse && (
                        <div className="flex items-center gap-2 mb-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                          <svg
                            className="h-3.5 w-3.5 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          <span>Using {currentToolUse}...</span>
                        </div>
                      )}
                      {streamingContent ? (
                        <p className="text-sm whitespace-pre-wrap">
                          {streamingContent}
                        </p>
                      ) : !currentToolUse ? (
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                          <div
                            className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                            style={{ animationDelay: '0.1s' }}
                          />
                          <div
                            className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                            style={{ animationDelay: '0.2s' }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="p-4 border-t border-slate-200">
            <div className="flex items-end gap-2">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                rows={1}
                className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                style={{ maxHeight: '120px' }}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || sending}
                className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>

      {/* Workflow Detail Modal */}
      {selectedWorkflow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl w-full max-w-7xl h-[90vh] flex shadow-2xl overflow-hidden relative">
            {/* Close Button - Top Right of Modal */}
            <button
              onClick={() => setSelectedWorkflow(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-white hover:bg-slate-100 rounded-lg transition-colors shadow-md"
            >
              <svg
                className="h-5 w-5 text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* Left Panel - Document Details */}
            <div
              className={`bg-slate-50 flex flex-col border-r border-slate-200 transition-all duration-300 ${analysisPopup.type ? 'w-[600px]' : 'w-[400px]'}`}
            >
              {/* Header */}
              <div className="p-5 border-b border-slate-200">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-slate-200 rounded-lg">
                    <svg
                      className="h-6 w-6 text-slate-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-slate-800">
                      Document Details
                    </h2>
                    <p className="text-sm text-slate-500">
                      Complete document information
                    </p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5">
                {loadingWorkflow ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-slate-500">Loading...</div>
                  </div>
                ) : analysisPopup.type ? (
                  /* Analysis Content View */
                  <div className="flex flex-col h-full">
                    {/* Navigation */}
                    <div className="flex items-center gap-2 mb-4">
                      <button
                        onClick={() =>
                          setAnalysisPopup({
                            type: null,
                            content: '',
                            title: '',
                          })
                        }
                        className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                        title="Back to Details"
                      >
                        <svg
                          className="h-4 w-4 text-slate-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 19l-7-7 7-7"
                          />
                        </svg>
                      </button>
                      <div className="flex gap-1 flex-1">
                        <button
                          onClick={() => {
                            const segment =
                              selectedWorkflow?.segments[currentSegmentIndex];
                            setAnalysisPopup({
                              type: 'bda',
                              content: segment?.bda_indexer || '',
                              title: `BDA Content - Segment ${currentSegmentIndex + 1}`,
                            });
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            analysisPopup.title.includes('BDA')
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          BDA
                        </button>
                        <button
                          onClick={() => {
                            const segment =
                              selectedWorkflow?.segments[currentSegmentIndex];
                            setAnalysisPopup({
                              type: 'bda',
                              content: segment?.paddleocr || '',
                              title: `OCR Content - Segment ${currentSegmentIndex + 1}`,
                            });
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            analysisPopup.title.includes('OCR')
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          OCR
                        </button>
                        <button
                          onClick={() => {
                            const segment =
                              selectedWorkflow?.segments[currentSegmentIndex];
                            setAnalysisPopup({
                              type: 'bda',
                              content: segment?.format_parser || '',
                              title: `PDF Content - Segment ${currentSegmentIndex + 1}`,
                            });
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            analysisPopup.title.includes('PDF')
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => {
                            const segment =
                              selectedWorkflow?.segments[currentSegmentIndex];
                            const qaItems =
                              segment?.ai_analysis?.map((a) => ({
                                question: a.analysis_query,
                                answer: a.content,
                              })) || [];
                            setAnalysisPopup({
                              type: 'ai',
                              content: '',
                              title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
                              qaItems,
                            });
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            analysisPopup.type === 'ai'
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          AI
                        </button>
                      </div>
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-semibold text-slate-800 mb-4">
                      {analysisPopup.title}
                    </h3>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                      {analysisPopup.type === 'ai' && analysisPopup.qaItems ? (
                        analysisPopup.qaItems.length === 0 ? (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                            <svg
                              className="h-12 w-12 mb-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <p className="text-sm font-medium">
                              No AI analysis for this segment
                            </p>
                          </div>
                        ) : (
                          <>
                            {/* Question Navigator */}
                            <div className="flex-shrink-0 flex flex-wrap gap-2 mb-4 pb-3 border-b border-slate-200">
                              {analysisPopup.qaItems.map((_, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => {
                                    document
                                      .getElementById(`qa-item-${idx}`)
                                      ?.scrollIntoView({ behavior: 'smooth' });
                                  }}
                                  className="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center transition-colors"
                                >
                                  Q{idx + 1}
                                </button>
                              ))}
                            </div>

                            {/* Q&A Cards */}
                            <div className="flex-1 overflow-y-auto space-y-4">
                              {analysisPopup.qaItems.map((item, idx) => (
                                <div
                                  key={idx}
                                  id={`qa-item-${idx}`}
                                  className="bg-white rounded-lg border border-slate-200 overflow-hidden scroll-mt-2"
                                >
                                  {/* Question */}
                                  <div className="bg-blue-50 border-b border-blue-100 px-4 py-3">
                                    <div className="flex items-start gap-2">
                                      <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                        Q{idx + 1}
                                      </span>
                                      <p className="text-sm font-medium text-slate-800">
                                        {item.question}
                                      </p>
                                    </div>
                                  </div>
                                  {/* Answer */}
                                  <div className="px-4 py-3">
                                    <div className="prose prose-slate prose-sm max-w-none prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:p-2 prose-td:border prose-td:border-slate-300 prose-td:p-2">
                                      <Markdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                          img: ({ src, alt }) => (
                                            <img
                                              src={src}
                                              alt={alt || ''}
                                              className="max-w-full h-auto rounded-lg shadow-md my-4"
                                              loading="lazy"
                                            />
                                          ),
                                        }}
                                        urlTransform={(url) => url}
                                      >
                                        {item.answer}
                                      </Markdown>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )
                      ) : !analysisPopup.content ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                          <svg
                            className="h-12 w-12 mb-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <p className="text-sm font-medium">
                            No content for this segment
                          </p>
                        </div>
                      ) : (
                        <div className="prose prose-slate prose-sm max-w-none prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:p-2 prose-td:border prose-td:border-slate-300 prose-td:p-2">
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              img: ({ src, alt }) => (
                                <img
                                  src={src}
                                  alt={alt || ''}
                                  className="max-w-full h-auto rounded-lg shadow-md my-4"
                                  loading="lazy"
                                />
                              ),
                            }}
                            urlTransform={(url) => url}
                          >
                            {analysisPopup.content}
                          </Markdown>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Basic Information */}
                    <div>
                      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-200">
                        <span className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 rounded">
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        </span>
                        Basic Information
                      </h3>

                      <div className="space-y-4">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">
                            File Name
                          </p>
                          <p className="text-sm text-slate-800">
                            {selectedWorkflow.file_name}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-slate-500 mb-1">
                              File Type
                            </p>
                            <span className="inline-block px-2 py-1 bg-slate-200 text-slate-700 text-xs rounded">
                              {selectedWorkflow.file_type || 'PDF'}
                            </span>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">
                              Total Segments
                            </p>
                            <p className="text-sm text-slate-800">
                              {selectedWorkflow.total_segments}
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500 mb-1">
                            Analysis Language
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded font-medium">
                              {LANGUAGES.find(
                                (l) =>
                                  l.code ===
                                  (selectedWorkflow.language || 'en'),
                              )?.flag || 'EN'}
                            </span>
                            <span className="text-sm text-slate-800">
                              {LANGUAGES.find(
                                (l) =>
                                  l.code ===
                                  (selectedWorkflow.language || 'en'),
                              )?.name || 'English'}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500 mb-1">Status</p>
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            <span className="text-sm text-slate-800">
                              {selectedWorkflow.status}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500 mb-1">Created</p>
                          <p className="text-sm text-slate-800">
                            {new Date(
                              selectedWorkflow.created_at,
                            ).toLocaleString('ko-KR')}
                          </p>
                        </div>
                      </div>
                    </div>

                    <hr className="border-slate-200" />

                    {/* Analysis Summary - Clickable */}
                    {selectedWorkflow.segments.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-slate-700 mb-4">
                          Segment {currentSegmentIndex + 1} Analysis
                        </h3>
                        <p className="text-xs text-slate-400 mb-3">
                          Click to view content
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const segment =
                                selectedWorkflow.segments[currentSegmentIndex];
                              if (segment?.bda_indexer) {
                                setAnalysisPopup({
                                  type: 'bda',
                                  content: segment.bda_indexer,
                                  title: `BDA Content - Segment ${currentSegmentIndex + 1}`,
                                });
                              }
                            }}
                            disabled={
                              !selectedWorkflow.segments[currentSegmentIndex]
                                ?.bda_indexer
                            }
                            className="flex-1 bg-white border border-slate-200 rounded-lg p-3 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <p className="text-xs text-slate-500">BDA</p>
                            <p className="text-lg font-semibold text-slate-800">
                              {selectedWorkflow.segments[currentSegmentIndex]
                                ?.bda_indexer
                                ? 1
                                : 0}
                            </p>
                          </button>
                          <button
                            onClick={() => {
                              const segment =
                                selectedWorkflow.segments[currentSegmentIndex];
                              if (segment?.paddleocr) {
                                setAnalysisPopup({
                                  type: 'bda',
                                  content: segment.paddleocr,
                                  title: `OCR Content - Segment ${currentSegmentIndex + 1}`,
                                });
                              }
                            }}
                            disabled={
                              !selectedWorkflow.segments[currentSegmentIndex]
                                ?.paddleocr
                            }
                            className="flex-1 bg-white border border-slate-200 rounded-lg p-3 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <p className="text-xs text-slate-500">OCR</p>
                            <p className="text-lg font-semibold text-slate-800">
                              {selectedWorkflow.segments[currentSegmentIndex]
                                ?.paddleocr
                                ? 1
                                : 0}
                            </p>
                          </button>
                          <button
                            onClick={() => {
                              const segment =
                                selectedWorkflow.segments[currentSegmentIndex];
                              if (segment?.format_parser) {
                                setAnalysisPopup({
                                  type: 'bda',
                                  content: segment.format_parser,
                                  title: `PDF Content - Segment ${currentSegmentIndex + 1}`,
                                });
                              }
                            }}
                            disabled={
                              !selectedWorkflow.segments[currentSegmentIndex]
                                ?.format_parser
                            }
                            className="flex-1 bg-white border border-slate-200 rounded-lg p-3 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <p className="text-xs text-slate-500">PDF</p>
                            <p className="text-lg font-semibold text-slate-800">
                              {selectedWorkflow.segments[currentSegmentIndex]
                                ?.format_parser
                                ? 1
                                : 0}
                            </p>
                          </button>
                          <button
                            onClick={() => {
                              const segment =
                                selectedWorkflow.segments[currentSegmentIndex];
                              if (segment?.ai_analysis?.length > 0) {
                                const qaItems = segment.ai_analysis.map(
                                  (a) => ({
                                    question: a.analysis_query,
                                    answer: a.content,
                                  }),
                                );
                                setAnalysisPopup({
                                  type: 'ai',
                                  content: '',
                                  title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
                                  qaItems,
                                });
                              }
                            }}
                            disabled={
                              !selectedWorkflow.segments[currentSegmentIndex]
                                ?.ai_analysis?.length
                            }
                            className="flex-1 bg-white border border-slate-200 rounded-lg p-3 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <p className="text-xs text-slate-500">AI</p>
                            <p className="text-lg font-semibold text-slate-800">
                              {selectedWorkflow.segments[currentSegmentIndex]
                                ?.ai_analysis?.length || 0}
                            </p>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Image Viewer */}
            <div className="flex-1 flex flex-col bg-slate-100">
              {/* Segment Navigation */}
              <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setImageLoading(true);
                      setCurrentSegmentIndex((prev) => Math.max(0, prev - 1));
                    }}
                    disabled={currentSegmentIndex === 0}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg
                      className="h-4 w-4 text-slate-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>

                  <select
                    value={currentSegmentIndex}
                    onChange={(e) => {
                      setImageLoading(true);
                      setCurrentSegmentIndex(Number(e.target.value));
                    }}
                    className="bg-white border border-slate-300 text-slate-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {selectedWorkflow.segments.map((segment, idx) => (
                      <option key={idx} value={idx}>
                        {segment.segment_type === 'CHAPTER'
                          ? `Chapter ${idx + 1}`
                          : segment.segment_type === 'VIDEO'
                            ? `Video ${idx + 1}`
                            : `Page ${idx + 1}`}
                      </option>
                    ))}
                  </select>

                  <span className="text-sm text-slate-500">
                    {currentSegmentIndex + 1}/{selectedWorkflow.total_segments}
                  </span>

                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full border border-green-200">
                    {selectedWorkflow.status}
                  </span>

                  <button
                    onClick={() => {
                      setImageLoading(true);
                      setCurrentSegmentIndex((prev) =>
                        Math.min(
                          selectedWorkflow.segments.length - 1,
                          prev + 1,
                        ),
                      );
                    }}
                    disabled={
                      currentSegmentIndex >=
                      selectedWorkflow.segments.length - 1
                    }
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg
                      className="h-4 w-4 text-slate-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Media Display (Image or Video) */}
              <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative">
                {selectedWorkflow.segments.length === 0 ? (
                  <div className="text-slate-500">No segments available</div>
                ) : (
                  (() => {
                    const currentSegment =
                      selectedWorkflow.segments[currentSegmentIndex];
                    const isVideoSegment =
                      currentSegment?.segment_type === 'VIDEO' ||
                      currentSegment?.segment_type === 'CHAPTER';

                    if (isVideoSegment && currentSegment?.video_url) {
                      return (
                        <div className="w-full h-full flex items-center justify-center">
                          <video
                            key={currentSegment.video_url}
                            controls
                            className="max-w-full max-h-full rounded-lg shadow-lg"
                            preload="metadata"
                          >
                            <source
                              src={currentSegment.video_url}
                              type="video/mp4"
                            />
                            <source
                              src={currentSegment.video_url}
                              type="video/webm"
                            />
                            Your browser does not support video playback.
                          </video>
                        </div>
                      );
                    }

                    if (currentSegment?.image_url) {
                      return (
                        <>
                          {imageLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
                              <div className="flex flex-col items-center gap-3">
                                <svg
                                  className="h-8 w-8 text-slate-400 animate-spin"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                  />
                                </svg>
                                <p className="text-sm text-slate-500">
                                  Loading image...
                                </p>
                              </div>
                            </div>
                          )}
                          <img
                            src={currentSegment.image_url}
                            alt={`Segment ${currentSegmentIndex + 1}`}
                            className={`max-w-full max-h-full object-contain rounded-lg shadow-lg transition-opacity ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                            onLoad={() => setImageLoading(false)}
                          />
                        </>
                      );
                    }

                    return (
                      <div className="flex flex-col items-center gap-4 text-slate-400">
                        <svg
                          className="h-16 w-16"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        <p>
                          {isVideoSegment
                            ? 'No video available for this segment'
                            : 'No image available for this segment'}
                        </p>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
