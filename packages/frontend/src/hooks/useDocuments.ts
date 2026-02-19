import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import { useWebSocketMessage } from '../contexts/WebSocketContext';
import type {
  Document,
  DocumentUploadResponse,
  Workflow,
  WorkflowDetail,
  WorkflowProgress,
  SegmentData,
  StepStatus,
} from '../types/project';
import type { DocumentProcessingOptions } from '../components/DocumentUploadModal';

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

interface UseDocumentsOptions {
  fetchApi: <T>(url: string, init?: RequestInit) => Promise<T>;
  projectId: string;
  wsStatus: string;
}

export function useDocuments({
  fetchApi,
  projectId,
  wsStatus,
}: UseDocumentsOptions) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowProgressMap, setWorkflowProgressMap] = useState<
    Record<string, WorkflowProgress>
  >({});
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowDetail | null>(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [initialSegmentIndex, setInitialSegmentIndex] = useState(0);
  const [loadingSourceKey, setLoadingSourceKey] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const progressFetchedRef = useRef(false);
  const loadDocumentsTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

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

  // Step labels for display
  const stepLabels = useMemo<Record<string, string>>(
    () => ({
      segment_prep: t('workflow.steps.segmentPrep'),
      webcrawler: t('workflow.steps.webcrawler'),
      bda_processor: t('workflow.steps.bdaProcessing'),
      format_parser: t('workflow.steps.formatParsing'),
      paddleocr_processor: t('workflow.steps.paddleocrProcessing'),
      transcribe: t('workflow.steps.transcription'),
      segment_builder: t('workflow.steps.buildingSegments'),
      segment_analyzer: t('workflow.steps.segmentAiAnalysis'),
      document_summarizer: t('workflow.steps.documentSummary'),
    }),
    [t],
  );

  // Fetch document progress from API
  const fetchDocumentProgress = useCallback(async () => {
    try {
      const progressData = await fetchApi<
        {
          document_id: string;
          workflow_id: string;
          status: string;
          current_step: string;
          steps: Record<string, { status: string; label: string }>;
        }[]
      >(`projects/${projectId}/documents/progress`);

      setWorkflowProgressMap((prev) => {
        const newMap = { ...prev };
        for (const progress of progressData) {
          const doc = documents.find(
            (d) => d.document_id === progress.document_id,
          );

          const steps: Record<string, StepStatus> = {};
          if (progress.steps) {
            for (const [key, val] of Object.entries(progress.steps)) {
              steps[key] = {
                status: val.status as StepStatus['status'],
                label: stepLabels[key] || val.label,
              };
            }
          }

          const currentStepLabel = progress.current_step
            ? stepLabels[progress.current_step] || progress.current_step
            : '';

          newMap[progress.document_id] = {
            workflowId: progress.workflow_id,
            documentId: progress.document_id,
            fileName: doc?.name || prev[progress.document_id]?.fileName || '',
            status: progress.status as WorkflowProgress['status'],
            currentStep: currentStepLabel,
            stepMessage: '',
            segmentProgress: null,
            error: progress.status === 'failed' ? 'Workflow failed' : null,
            steps,
          };
        }
        return newMap;
      });
    } catch (error) {
      console.error('Failed to fetch document progress:', error);
    }
  }, [fetchApi, projectId, documents, stepLabels]);

  // Keep stable refs for effects
  const fetchProgressRef = useRef(fetchDocumentProgress);
  const loadWorkflowsRef = useRef(loadWorkflows);
  const loadDocumentsRef = useRef(loadDocuments);
  fetchProgressRef.current = fetchDocumentProgress;
  loadWorkflowsRef.current = loadWorkflows;
  loadDocumentsRef.current = loadDocuments;

  const debouncedLoadDocuments = useCallback(() => {
    if (loadDocumentsTimerRef.current) {
      clearTimeout(loadDocumentsTimerRef.current);
    }
    loadDocumentsTimerRef.current = setTimeout(() => {
      loadDocumentsRef.current();
    }, 500);
  }, []);

  // Reconcile progress: replace entire map from API, removing stale entries
  const reconcileProgress = useCallback(async () => {
    try {
      const progressData = await fetchApi<
        {
          document_id: string;
          workflow_id: string;
          status: string;
          current_step: string;
          steps: Record<string, { status: string; label: string }>;
        }[]
      >(`projects/${projectId}/documents/progress`);

      const newMap: Record<string, WorkflowProgress> = {};
      for (const progress of progressData) {
        const doc = documents.find(
          (d) => d.document_id === progress.document_id,
        );

        const steps: Record<string, StepStatus> = {};
        if (progress.steps) {
          for (const [key, val] of Object.entries(progress.steps)) {
            steps[key] = {
              status: val.status as StepStatus['status'],
              label: stepLabels[key] || val.label,
            };
          }
        }

        const currentStepLabel = progress.current_step
          ? stepLabels[progress.current_step] || progress.current_step
          : '';

        newMap[progress.document_id] = {
          workflowId: progress.workflow_id,
          documentId: progress.document_id,
          fileName: doc?.name || '',
          status: progress.status as WorkflowProgress['status'],
          currentStep: currentStepLabel,
          stepMessage: '',
          segmentProgress: null,
          error: progress.status === 'failed' ? 'Workflow failed' : null,
          steps,
        };
      }

      setWorkflowProgressMap(newMap);
    } catch {
      fetchProgressRef.current();
    }
  }, [fetchApi, projectId, documents, stepLabels]);

  const reconcileProgressRef = useRef(reconcileProgress);
  reconcileProgressRef.current = reconcileProgress;

  // Sync state on WebSocket reconnect
  const prevWsStatusRef = useRef(wsStatus);
  const wsConnectedOnceRef = useRef(false);
  useEffect(() => {
    const wasDisconnected = prevWsStatusRef.current !== 'connected';
    prevWsStatusRef.current = wsStatus;

    if (wsStatus === 'connected') {
      if (wasDisconnected && wsConnectedOnceRef.current) {
        loadDocumentsRef.current();
        loadWorkflowsRef.current();
        reconcileProgressRef.current();
      }
      wsConnectedOnceRef.current = true;
    }
  }, [wsStatus]);

  // WebSocket workflow status change handler
  const handleWorkflowMessage = useCallback(
    (data: {
      event: string;
      workflowId: string;
      documentId: string;
      projectId: string;
      status: string;
      previousStatus?: string;
      timestamp: string;
    }) => {
      if (data.projectId !== projectId) return;

      if (data.event === 'status_changed') {
        if (data.status === 'in_progress') {
          setWorkflowProgressMap((prev) => {
            const existing = prev[data.documentId];
            return {
              ...prev,
              [data.documentId]: {
                workflowId: data.workflowId,
                documentId: data.documentId,
                fileName: existing?.fileName || '',
                status: 'in_progress',
                currentStep:
                  existing?.currentStep ||
                  t('workflow.starting', 'Starting...'),
                stepMessage: '',
                segmentProgress: existing?.segmentProgress || null,
                error: null,
                steps: existing?.steps || {},
              },
            };
          });

          setWorkflows((prev) => {
            if (prev.some((w) => w.workflow_id === data.workflowId))
              return prev;
            return [
              ...prev,
              {
                workflow_id: data.workflowId,
                document_id: data.documentId,
                status: 'in_progress',
                file_name: '',
                file_uri: '',
                language: null,
                created_at: data.timestamp,
                updated_at: data.timestamp,
              },
            ];
          });

          debouncedLoadDocuments();

          // Fetch step progress after a short delay so the API has data
          setTimeout(() => {
            fetchProgressRef.current();
          }, 2000);
        } else if (data.status === 'completed' || data.status === 'failed') {
          setWorkflowProgressMap((prev) => {
            if (!prev[data.documentId]) return prev;
            return {
              ...prev,
              [data.documentId]: {
                ...prev[data.documentId],
                status: data.status as 'completed' | 'failed',
              },
            };
          });

          setTimeout(() => {
            loadDocuments();
          }, 1500);
        }

        loadWorkflows();
      }
    },
    [projectId, loadDocuments, loadWorkflows, debouncedLoadDocuments, t],
  );

  useWebSocketMessage('workflow', handleWorkflowMessage);

  // WebSocket step progress handler (uses ref to avoid resubscription on documents change)
  const handleStepMessage = useCallback(
    (data: {
      event: string;
      workflowId: string;
      documentId: string;
      projectId: string;
      stepName: string;
      status: string;
      previousStatus?: string;
      currentStep?: string;
      timestamp: string;
    }) => {
      if (data.projectId !== projectId) return;
      if (data.event === 'step_changed') {
        fetchProgressRef.current();
      }
    },
    [projectId],
  );

  useWebSocketMessage('step', handleStepMessage);

  // WebSocket document event handler (e.g. deleted by another user)
  const handleDocumentMessage = useCallback(
    (data: {
      event: string;
      documentId: string;
      projectId: string;
      timestamp: string;
    }) => {
      if (data.projectId !== projectId) return;

      if (data.event === 'deleted') {
        setDocuments((prev) =>
          prev.filter((d) => d.document_id !== data.documentId),
        );
        setWorkflows((prev) =>
          prev.filter((w) => w.document_id !== data.documentId),
        );
        setWorkflowProgressMap((prev) => {
          if (!prev[data.documentId]) return prev;
          const newMap = { ...prev };
          delete newMap[data.documentId];
          return newMap;
        });
      }
    },
    [projectId],
  );

  useWebSocketMessage('document', handleDocumentMessage);

  // Fetch real step progress for in-progress workflows on page load (once)
  const fetchProgressOnLoad = useCallback(
    (loading: boolean) => {
      if (loading) return;
      if (progressFetchedRef.current) return;

      const inProgressWorkflows = workflows.filter(
        (w) => w.status === 'in_progress' || w.status === 'processing',
      );
      if (inProgressWorkflows.length === 0) return;

      progressFetchedRef.current = true;
      fetchProgressRef.current();
    },
    [workflows],
  );

  // Handle workflow completion/failure - clear completed/failed after delay
  useEffect(() => {
    const completedDocIds = Object.entries(workflowProgressMap)
      .filter(
        ([, progress]) =>
          progress.status === 'completed' || progress.status === 'failed',
      )
      .map(([docId]) => docId);

    if (completedDocIds.length === 0) return;

    loadDocumentsRef.current();
    loadWorkflowsRef.current();
    const timeout = setTimeout(() => {
      setWorkflowProgressMap((prev) => {
        const newMap = { ...prev };
        for (const docId of completedDocIds) {
          delete newMap[docId];
        }
        return newMap;
      });
    }, 5000);
    return () => clearTimeout(timeout);
  }, [workflowProgressMap]);

  // Clean up progressMap when documents show completed/failed status
  useEffect(() => {
    setWorkflowProgressMap((prev) => {
      const newMap = { ...prev };
      let changed = false;
      for (const docId of Object.keys(newMap)) {
        const doc = documents.find((d) => d.document_id === docId);
        if (doc && (doc.status === 'completed' || doc.status === 'failed')) {
          delete newMap[docId];
          changed = true;
        }
      }
      return changed ? newMap : prev;
    });
  }, [documents]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (loadDocumentsTimerRef.current) {
        clearTimeout(loadDocumentsTimerRef.current);
      }
    };
  }, []);

  const processFiles = useCallback(
    async (files: File[], options: DocumentProcessingOptions) => {
      if (files.length === 0) return;

      const maxSize = 500 * 1024 * 1024;
      setUploading(true);
      setShowUploadModal(false);
      try {
        for (const file of Array.from(files)) {
          if (file.size > maxSize) {
            console.error(`File ${file.name} exceeds 500MB limit`);
            continue;
          }

          const uploadInfo = await fetchApi<DocumentUploadResponse>(
            `projects/${projectId}/documents`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                file_name: file.name,
                content_type: file.type || 'application/octet-stream',
                file_size: file.size,
                use_bda: options.use_bda,
                use_ocr: options.use_ocr,
                ocr_model: options.ocr_model,
                ocr_options: options.ocr_options,
                document_prompt: options.document_prompt,
                language: options.language,
              }),
            },
          );

          setDocuments((prev) => [
            ...prev,
            {
              document_id: uploadInfo.document_id,
              name: file.name,
              file_type: file.type || 'application/octet-stream',
              file_size: file.size,
              status: 'uploading',
              use_bda: options.use_bda,
              started_at: new Date().toISOString(),
              ended_at: null,
            },
          ]);

          setWorkflowProgressMap((prev) => ({
            ...prev,
            [uploadInfo.document_id]: {
              workflowId: '',
              documentId: uploadInfo.document_id,
              fileName: file.name,
              status: 'pending',
              currentStep: t('workflow.uploading', 'Uploading...'),
              stepMessage: '',
              segmentProgress: null,
              error: null,
            },
          }));

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

          await fetchApi(
            `projects/${projectId}/documents/${uploadInfo.document_id}/status`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'uploaded' }),
            },
          );
        }
        await loadDocuments();
      } catch (error) {
        console.error('Failed to upload document:', error);
      }
      setUploading(false);
    },
    [fetchApi, projectId, loadDocuments, t],
  );

  const handleDeleteDocument = useCallback(
    (documentId: string) => {
      const doc = documents.find((d) => d.document_id === documentId);
      if (doc) {
        setDeleteTarget(doc);
      }
    },
    [documents],
  );

  const confirmDeleteDocument = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetchApi(
        `projects/${projectId}/documents/${deleteTarget.document_id}`,
        { method: 'DELETE' },
      );
      await loadDocuments();
      setDeleteTarget(null);
    } catch (error) {
      console.error('Failed to delete document:', error);
    } finally {
      setDeleting(false);
    }
  }, [fetchApi, projectId, deleteTarget, loadDocuments]);

  const loadWorkflowDetail = useCallback(
    async (documentId: string, workflowId: string) => {
      setLoadingWorkflow(true);
      try {
        const data = await fetchApi<WorkflowDetail>(
          `documents/${documentId}/workflows/${workflowId}`,
        );
        setSelectedWorkflow(data);
      } catch (error) {
        console.error('Failed to load workflow detail:', error);
        showToast(
          'error',
          t('workflow.loadError', 'Failed to load workflow details'),
        );
      }
      setLoadingWorkflow(false);
    },
    [fetchApi, showToast, t],
  );

  const loadSegment = useCallback(
    async (
      documentId: string,
      workflowId: string,
      segmentIndex: number,
    ): Promise<SegmentData> => {
      const data = await fetchApi<SegmentData>(
        `documents/${documentId}/workflows/${workflowId}/segments/${segmentIndex}`,
      );
      return data;
    },
    [fetchApi],
  );

  const handleLoadSegment = useCallback(
    (segmentIndex: number) => {
      if (!selectedWorkflow) return Promise.reject('No workflow selected');
      return loadSegment(
        selectedWorkflow.document_id,
        selectedWorkflow.workflow_id,
        segmentIndex,
      );
    },
    [loadSegment, selectedWorkflow],
  );

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

  const handleRegenerateQa = useCallback(
    async (
      segmentIndex: number,
      qaIndex: number,
      question: string,
      userInstructions: string,
    ) => {
      if (!selectedWorkflow) throw new Error('No workflow selected');

      return await fetchApi<{
        analysis_query: string;
        content: string;
      }>(
        `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/segments/${segmentIndex}/regenerate-qa`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            qa_index: qaIndex,
            question,
            user_instructions: userInstructions,
          }),
        },
      );
    },
    [fetchApi, selectedWorkflow],
  );

  const handleAddQa = useCallback(
    async (
      segmentIndex: number,
      question: string,
      userInstructions: string,
    ) => {
      if (!selectedWorkflow) throw new Error('No workflow selected');

      return await fetchApi<{
        analysis_query: string;
        content: string;
        qa_index: number;
      }>(
        `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/segments/${segmentIndex}/add-qa`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            user_instructions: userInstructions,
          }),
        },
      );
    },
    [fetchApi, selectedWorkflow],
  );

  const handleDeleteQa = useCallback(
    async (segmentIndex: number, qaIndex: number) => {
      if (!selectedWorkflow) throw new Error('No workflow selected');

      return await fetchApi<{
        deleted: boolean;
        deleted_query: string;
        qa_index: number;
      }>(
        `documents/${selectedWorkflow.document_id}/workflows/${selectedWorkflow.workflow_id}/segments/${segmentIndex}/qa/${qaIndex}`,
        { method: 'DELETE' },
      );
    },
    [fetchApi, selectedWorkflow],
  );

  const handleSourceClick = useCallback(
    async (documentId: string, segmentId: string) => {
      const workflow = workflows.find((w) => w.document_id === documentId);
      if (!workflow) return;
      const segIdx = parseInt(segmentId.split('_').pop() || '0', 10);
      setInitialSegmentIndex(segIdx);
      setLoadingSourceKey(`${documentId}:${segmentId}`);
      await loadWorkflowDetail(documentId, workflow.workflow_id);
      setLoadingSourceKey(null);
    },
    [workflows, loadWorkflowDetail],
  );

  return {
    documents,
    setDocuments,
    workflows,
    setWorkflows,
    workflowProgressMap,
    uploading,
    deleteTarget,
    setDeleteTarget,
    deleting,
    selectedWorkflow,
    setSelectedWorkflow,
    loadingWorkflow,
    reanalyzing,
    initialSegmentIndex,
    setInitialSegmentIndex,
    loadingSourceKey,
    showUploadModal,
    setShowUploadModal,
    loadDocuments,
    loadWorkflows,
    fetchProgressOnLoad,
    processFiles,
    handleDeleteDocument,
    confirmDeleteDocument,
    loadWorkflowDetail,
    handleLoadSegment,
    handleReanalyze,
    handleRegenerateQa,
    handleAddQa,
    handleDeleteQa,
    handleSourceClick,
  };
}
