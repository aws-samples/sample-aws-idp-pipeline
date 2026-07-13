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

const EXT_MIME: Record<string, string> = {
  dxf: 'application/dxf',
  // Structured data: browsers often leave file.type empty for these, so map by
  // extension to the MIME types the backend uses to classify datasets.
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const getMimeTypeByExt = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return EXT_MIME[ext] || 'application/octet-stream';
};

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
  // Track deferred timers from WebSocket status events so they can all be
  // cancelled on unmount / project switch (otherwise late fetches fire stale).
  const deferredTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const deferTimer = useCallback((fn: () => void, delayMs: number) => {
    const id = setTimeout(() => {
      deferredTimersRef.current.delete(id);
      fn();
    }, delayMs);
    deferredTimersRef.current.add(id);
  }, []);

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
      graph_builder: t('workflow.steps.graphBuilder'),
      document_summarizer: t('workflow.steps.documentSummary'),
      dataset_process: t('workflow.steps.datasetProcess', 'Dataset Processing'),
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
          steps: Record<
            string,
            {
              status: string;
              label: string;
              error?: string;
              reason?: string;
              qa_regen?: { status: string; segment_index: number };
            }
          >;
        }[]
      >(`projects/${projectId}/documents/progress`);

      setWorkflowProgressMap((prev) => {
        const newMap = { ...prev };
        for (const progress of progressData) {
          const doc = documents.find(
            (d) => d.document_id === progress.document_id,
          );

          const steps: Record<string, StepStatus> = {};
          let qaRegen: { status: string; segmentIndex: number } | null = null;
          if (progress.steps) {
            for (const [key, val] of Object.entries(progress.steps)) {
              steps[key] = {
                status: val.status as StepStatus['status'],
                label: stepLabels[key] || val.label,
                ...(val.error && { error: val.error }),
                ...(val.reason && { reason: val.reason }),
              };
            }
            const segAnalyzer = progress.steps.segment_analyzer;
            if (segAnalyzer?.qa_regen) {
              qaRegen = {
                status: segAnalyzer.qa_regen.status,
                segmentIndex: segAnalyzer.qa_regen.segment_index,
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
            qaRegen,
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
          steps: Record<
            string,
            {
              status: string;
              label: string;
              error?: string;
              reason?: string;
              qa_regen?: { status: string; segment_index: number };
            }
          >;
        }[]
      >(`projects/${projectId}/documents/progress`);

      const newMap: Record<string, WorkflowProgress> = {};
      for (const progress of progressData) {
        const doc = documents.find(
          (d) => d.document_id === progress.document_id,
        );

        const steps: Record<string, StepStatus> = {};
        let qaRegen: { status: string; segmentIndex: number } | null = null;
        if (progress.steps) {
          for (const [key, val] of Object.entries(progress.steps)) {
            steps[key] = {
              status: val.status as StepStatus['status'],
              label: stepLabels[key] || val.label,
              ...(val.error && { error: val.error }),
              ...(val.reason && { reason: val.reason }),
            };
          }
          const segAnalyzer = progress.steps.segment_analyzer;
          if (segAnalyzer?.qa_regen) {
            qaRegen = {
              status: segAnalyzer.qa_regen.status,
              segmentIndex: segAnalyzer.qa_regen.segment_index,
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
          qaRegen,
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
          deferTimer(() => {
            fetchProgressRef.current();
          }, 2000);
        } else if (data.status === 'reanalyzing') {
          // Reanalysis: document already exists, just update progress map
          setWorkflowProgressMap((prev) => ({
            ...prev,
            [data.documentId]: {
              workflowId: data.workflowId,
              documentId: data.documentId,
              fileName: prev[data.documentId]?.fileName || '',
              status: 'reanalyzing',
              currentStep: t('workflow.reanalyzing', 'Re-analyzing...'),
              stepMessage: '',
              segmentProgress: null,
              error: null,
              steps: prev[data.documentId]?.steps || {},
            },
          }));

          // Update document status locally without API call
          setDocuments((prev) =>
            prev.map((d) =>
              d.document_id === data.documentId
                ? { ...d, status: 'reanalyzing' }
                : d,
            ),
          );

          deferTimer(() => {
            fetchProgressRef.current();
          }, 2000);
        } else if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'needs_user_fix'
        ) {
          setWorkflowProgressMap((prev) => {
            if (!prev[data.documentId]) return prev;
            return {
              ...prev,
              [data.documentId]: {
                ...prev[data.documentId],
                status: data.status as
                  | 'completed'
                  | 'failed'
                  | 'needs_user_fix',
              },
            };
          });

          deferTimer(() => {
            loadDocuments();
            loadWorkflows();
          }, 1500);
        }
      }
    },
    [
      projectId,
      loadDocuments,
      loadWorkflows,
      debouncedLoadDocuments,
      deferTimer,
      t,
    ],
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

  // Handle workflow completion/failure - clear completed/failed after delay.
  // Refresh once per completed workflow: without this, any change to
  // workflowProgressMap (e.g. another workflow's progress) would re-trigger a
  // full loadDocuments/loadWorkflows while completed entries linger in the map.
  const refreshedCompletionsRef = useRef<Set<string>>(new Set());
  // Reset the completion dedupe set when the project changes so it can't grow
  // unbounded across a long-lived session spanning many projects/documents.
  useEffect(() => {
    refreshedCompletionsRef.current = new Set();
  }, [projectId]);
  useEffect(() => {
    const completed = Object.entries(workflowProgressMap).filter(
      ([, progress]) =>
        (progress.status === 'completed' ||
          progress.status === 'failed' ||
          progress.status === 'needs_user_fix') &&
        progress.qaRegen?.status !== 'in_progress',
    );

    // Only act on completions not already refreshed (keyed by doc+workflow so a
    // re-analysis with a new workflow_id refreshes again).
    const fresh = completed.filter(
      ([docId, p]) =>
        !refreshedCompletionsRef.current.has(`${docId}:${p.workflowId}`),
    );
    if (fresh.length === 0) return;

    for (const [docId, p] of fresh) {
      refreshedCompletionsRef.current.add(`${docId}:${p.workflowId}`);
    }

    loadDocumentsRef.current();
    loadWorkflowsRef.current();
    const completedDocIds = fresh.map(([docId]) => docId);
    const timeout = setTimeout(() => {
      setWorkflowProgressMap((prev) => {
        const newMap = { ...prev };
        for (const docId of completedDocIds) {
          if (newMap[docId]?.qaRegen?.status === 'in_progress') continue;
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
        // Keep entry if qa_regen is active
        if (newMap[docId]?.qaRegen?.status === 'in_progress') continue;
        if (
          doc &&
          (doc.status === 'completed' ||
            doc.status === 'failed' ||
            doc.status === 'needs_user_fix')
        ) {
          delete newMap[docId];
          changed = true;
        }
      }
      return changed ? newMap : prev;
    });
  }, [documents]);

  // Clean up debounce timer and any deferred WebSocket-event timers on unmount
  useEffect(() => {
    const deferred = deferredTimersRef.current;
    return () => {
      if (loadDocumentsTimerRef.current) {
        clearTimeout(loadDocumentsTimerRef.current);
      }
      for (const id of deferred) clearTimeout(id);
      deferred.clear();
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
                content_type: file.type || getMimeTypeByExt(file.name),
                file_size: file.size,
                use_bda: options.use_bda,
                use_ocr: options.use_ocr,
                use_transcribe: options.use_transcribe,
                ocr_model: options.ocr_model,
                ocr_options: options.ocr_options,
                transcribe_options: options.transcribe_options,
                document_prompt: options.document_prompt,
                language: options.language,
                source_url: options.source_url,
                crawl_instruction: options.crawl_instruction,
              }),
            },
          );

          setDocuments((prev) => [
            ...prev,
            {
              document_id: uploadInfo.document_id,
              name: file.name,
              file_type: file.type || getMimeTypeByExt(file.name),
              file_size: file.size,
              status: 'uploading',
              use_bda: options.use_bda,
              use_transcribe: options.use_transcribe,
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
              'Content-Type': file.type || getMimeTypeByExt(file.name),
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
    async (userInstructions: string, language?: string) => {
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
            body: JSON.stringify({
              user_instructions: userInstructions,
              language: language || 'en',
            }),
          },
        );
        showToast('success', t('workflow.reanalyzeStarted'));

        // Add to progress map so SidePanel shows reanalysis progress
        setWorkflowProgressMap((prev) => ({
          ...prev,
          [selectedWorkflow.document_id]: {
            workflowId: selectedWorkflow.workflow_id,
            documentId: selectedWorkflow.document_id,
            fileName: selectedWorkflow.file_name || '',
            status: 'reanalyzing',
            currentStep: t('workflow.reanalyzing', 'Re-analyzing...'),
            stepMessage: '',
            segmentProgress: null,
            error: null,
            steps: {},
          },
        }));

        // Update document status locally
        setDocuments((prev) =>
          prev.map((d) =>
            d.document_id === selectedWorkflow.document_id
              ? { ...d, status: 'reanalyzing' }
              : d,
          ),
        );

        setSelectedWorkflow(null);
      } catch (error) {
        console.error('Failed to start re-analysis:', error);
        showToast('error', t('workflow.reanalyzeFailed'));
      } finally {
        setReanalyzing(false);
      }
    },
    [fetchApi, selectedWorkflow, showToast, t],
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
