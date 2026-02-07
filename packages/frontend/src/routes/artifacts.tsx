import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation, getI18n } from 'react-i18next';
import {
  FileText,
  Image,
  Film,
  FileCode,
  FileSpreadsheet,
  File,
  Search,
  MoreVertical,
  Download,
  Trash2,
  Layers,
  Loader2,
  ChevronDown,
  X,
  ExternalLink,
  Presentation,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import mammoth from 'mammoth';
import { init as initPptxPreview } from 'pptx-preview';
import { useAwsClient } from '../hooks/useAwsClient';
import { useToast } from '../components/Toast';
import { Artifact, ArtifactsResponse } from '../types/project';
import ConfirmModal from '../components/ConfirmModal';

export const Route = createFileRoute('/artifacts')({
  component: ArtifactsPage,
});

function getArtifactIcon(contentType: string) {
  if (contentType.startsWith('image/')) return Image;
  if (contentType.startsWith('video/')) return Film;
  if (contentType === 'application/pdf') return FileText;
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/msword'
  )
    return FileText;
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    contentType === 'application/vnd.ms-powerpoint'
  )
    return Presentation;
  if (
    contentType === 'application/vnd.ms-excel' ||
    contentType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    contentType === 'text/csv'
  )
    return FileSpreadsheet;
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/javascript'
  )
    return FileCode;
  return File;
}

function getIconClass(contentType: string): string {
  if (contentType.startsWith('image/')) return 'bg-purple-500';
  if (contentType.startsWith('video/')) return 'bg-pink-500';
  if (contentType === 'application/pdf') return 'bg-red-500';
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/msword'
  )
    return 'bg-indigo-500';
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    contentType === 'application/vnd.ms-powerpoint'
  )
    return 'bg-orange-500';
  if (
    contentType === 'application/vnd.ms-excel' ||
    contentType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    contentType === 'text/csv'
  )
    return 'bg-green-500';
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/javascript'
  )
    return 'bg-blue-500';
  return 'bg-slate-500';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function ArtifactsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { fetchApi, getPresignedDownloadUrl } = useAwsClient();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [artifactToDelete, setArtifactToDelete] = useState<Artifact | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);
  const [viewingArtifact, setViewingArtifact] = useState<Artifact | null>(null);
  const [viewerContent, setViewerContent] = useState<string | null>(null);
  const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const pptxContainerRef = useRef<HTMLDivElement>(null);
  const pptxDataRef = useRef<ArrayBuffer | null>(null);

  const renderPptx = useCallback((arrayBuffer: ArrayBuffer) => {
    if (!pptxContainerRef.current) return;
    pptxContainerRef.current.innerHTML = '';
    const containerWidth = pptxContainerRef.current.clientWidth - 32;
    const width = containerWidth;
    const height = Math.round(width * 0.5625); // 16:9 aspect ratio
    const previewer = initPptxPreview(pptxContainerRef.current, {
      width,
      height,
    });
    previewer.preview(arrayBuffer).then(() => {
      const wrapper = pptxContainerRef.current
        ?.firstElementChild as HTMLElement | null;
      if (wrapper) {
        wrapper.style.setProperty('height', 'auto', 'important');
        wrapper.style.setProperty('overflow-y', 'visible', 'important');
      }
    });
  }, []);

  const handleCopyProjectId = async (
    projectId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(projectId);
    setCopiedProjectId(projectId);
    setTimeout(() => setCopiedProjectId(null), 1500);
  };

  const loadArtifacts = useCallback(
    async (cursor?: string) => {
      try {
        const url = cursor ? `artifacts?next_cursor=${cursor}` : 'artifacts';
        const data = await fetchApi<ArtifactsResponse>(url);
        if (cursor) {
          setArtifacts((prev) => [...prev, ...data.items]);
        } else {
          setArtifacts(data.items);
        }
        setNextCursor(data.next_cursor);
      } catch (error) {
        console.error('Failed to load artifacts:', error);
      }
    },
    [fetchApi],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await loadArtifacts();
      setLoading(false);
    };
    load();
  }, [loadArtifacts]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await loadArtifacts(nextCursor);
    setLoadingMore(false);
  };

  const filteredArtifacts = artifacts.filter(
    (artifact) =>
      artifact.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      artifact.content_type.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleMenuToggle = (artifactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === artifactId ? null : artifactId);
  };

  const handleDownload = async (artifact: Artifact) => {
    setOpenMenuId(null);
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
  };

  const handleDeleteClick = (artifact: Artifact) => {
    setOpenMenuId(null);
    setArtifactToDelete(artifact);
  };

  const handleConfirmDelete = async () => {
    if (!artifactToDelete) return;
    setDeleting(true);
    try {
      await fetchApi(`artifacts/${artifactToDelete.artifact_id}`, {
        method: 'DELETE',
      });
      setArtifacts((prev) =>
        prev.filter((a) => a.artifact_id !== artifactToDelete.artifact_id),
      );
    } catch (error) {
      console.error('Failed to delete artifact:', error);
    } finally {
      setDeleting(false);
      setArtifactToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const locale = getI18n().language || 'en';
    return date.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleViewArtifact = useCallback(
    async (artifact: Artifact) => {
      setViewingArtifact(artifact);
      setViewerLoading(true);
      setViewerError(null);
      setViewerContent(null);
      setViewerImageUrl(null);

      const imageExtensions = [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.svg',
      ];
      const isImage =
        artifact.content_type.startsWith('image/') ||
        imageExtensions.some((ext) =>
          artifact.filename.toLowerCase().endsWith(ext),
        );
      const isText =
        artifact.content_type.startsWith('text/') ||
        artifact.content_type === 'application/json';
      const isPdf =
        artifact.content_type === 'application/pdf' ||
        artifact.filename.toLowerCase().endsWith('.pdf');
      const isDocx =
        artifact.content_type ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        artifact.filename.toLowerCase().endsWith('.docx');
      const isPptx =
        artifact.content_type ===
          'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        artifact.filename.toLowerCase().endsWith('.pptx');

      try {
        const presignedUrl = await getPresignedDownloadUrl(
          artifact.s3_bucket,
          artifact.s3_key,
        );

        if (isImage || isPdf) {
          setViewerImageUrl(presignedUrl);
        } else if (isPptx) {
          const response = await fetch(presignedUrl);
          if (!response.ok) {
            throw new Error(`Failed to load: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          pptxDataRef.current = arrayBuffer;
          // Use setTimeout to ensure container is ready
          setTimeout(() => {
            renderPptx(arrayBuffer);
          }, 100);
        } else if (isDocx) {
          const response = await fetch(presignedUrl);
          if (!response.ok) {
            throw new Error(`Failed to load: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setViewerContent(result.value);
        } else if (isText) {
          const response = await fetch(presignedUrl);
          if (!response.ok) {
            throw new Error(`Failed to load: ${response.status}`);
          }
          const text = await response.text();
          setViewerContent(text);
        } else {
          setViewerError(
            t(
              'artifacts.unsupportedType',
              'Preview not available for this file type',
            ),
          );
        }
      } catch (err) {
        console.error('Failed to load artifact:', err);
        setViewerError(t('artifacts.loadError', 'Failed to load artifact'));
      } finally {
        setViewerLoading(false);
      }
    },
    [getPresignedDownloadUrl, renderPptx, t],
  );

  const handleCloseViewer = useCallback(() => {
    setViewingArtifact(null);
    setViewerContent(null);
    setViewerImageUrl(null);
    setViewerError(null);
    pptxDataRef.current = null;
  }, []);

  // Resize PPTX on container resize
  useEffect(() => {
    if (!viewingArtifact || !pptxContainerRef.current) return;

    const isPptx =
      viewingArtifact.content_type ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      viewingArtifact.filename.toLowerCase().endsWith('.pptx');

    if (!isPptx) return;

    const resizeObserver = new ResizeObserver(() => {
      if (pptxDataRef.current) {
        renderPptx(pptxDataRef.current);
      }
    });

    resizeObserver.observe(pptxContainerRef.current);
    return () => resizeObserver.disconnect();
  }, [viewingArtifact, renderPptx]);

  const handleGoToProject = useCallback(
    (projectId: string) => {
      navigate({ to: '/projects/$projectId', params: { projectId } });
    },
    [navigate],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bento-page">
      {/* Hero Section */}
      <header className="bento-hero">
        <div className="bento-hero-content">
          <div className="bento-hero-label">
            <span className="bento-hero-accent" />
            <span>{t('artifacts.heroTag', 'Files & Artifacts')}</span>
          </div>
          <h1 className="bento-hero-title">
            {t(
              'artifacts.heroTitle',
              'Your uploaded files and generated artifacts',
            )}
          </h1>
          <p className="bento-hero-description">
            {t(
              'artifacts.heroDescription',
              'Browse and manage files uploaded during conversations.\nDownload or delete your content anytime.',
            )}
          </p>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('artifacts.searchPlaceholder', 'Search files...')}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all"
          />
        </div>

        {/* Count */}
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
          <Layers className="w-4 h-4" />
          <span>
            {filteredArtifacts.length} {t('artifacts.items', 'files')}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="pb-8">
        {filteredArtifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Layers className="w-16 h-16 mb-4 text-slate-300 dark:text-slate-600" />
            <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t('artifacts.noArtifacts', 'No files yet')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
              {t(
                'artifacts.noArtifactsDescription',
                'Files uploaded during chat conversations will appear here.',
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredArtifacts.map((artifact) => {
                const ArtifactIcon = getArtifactIcon(artifact.content_type);
                const iconClass = getIconClass(artifact.content_type);
                return (
                  <div
                    key={artifact.artifact_id}
                    className="artifact-card group cursor-pointer"
                    onClick={() => handleViewArtifact(artifact)}
                  >
                    {/* Gradient overlay */}
                    <div className="artifact-card-gradient" />

                    {/* Content */}
                    <div className="relative p-5">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconClass}`}
                          >
                            <ArtifactIcon className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-tight truncate">
                              {artifact.filename}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {artifact.content_type.split('/')[1] ||
                                  artifact.content_type}
                              </span>
                              <span className="text-slate-300 dark:text-slate-600">
                                |
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {formatFileSize(artifact.file_size)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Menu */}
                        <div className="relative" data-artifact-menu>
                          <button
                            onClick={(e) =>
                              handleMenuToggle(artifact.artifact_id, e)
                            }
                            className={`p-1.5 rounded-lg transition-all ${
                              openMenuId === artifact.artifact_id
                                ? 'opacity-100 bg-slate-100 dark:bg-slate-700'
                                : 'opacity-0 group-hover:opacity-100'
                            } text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700`}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {openMenuId === artifact.artifact_id && (
                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1 overflow-hidden">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(artifact);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                              >
                                <Download className="w-4 h-4" />
                                {t('common.download', 'Download')}
                              </button>
                              <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteClick(artifact);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                <Trash2 className="w-4 h-4" />
                                {t('common.delete')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {formatDate(artifact.created_at)}
                        </span>
                        <button
                          onClick={(e) =>
                            handleCopyProjectId(artifact.project_id, e)
                          }
                          className="text-xs text-slate-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-400 truncate max-w-[140px] transition-colors"
                        >
                          {copiedProjectId === artifact.project_id
                            ? t('common.copied', 'Copied!')
                            : artifact.project_id}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load More */}
            {nextCursor && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  {loadingMore
                    ? t('common.loading', 'Loading...')
                    : t('common.loadMore', 'Load more')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!artifactToDelete}
        onClose={() => setArtifactToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('artifacts.deleteArtifact', 'Delete File')}
        message={t(
          'artifacts.deleteArtifactConfirm',
          'Are you sure you want to delete this file? This action cannot be undone.',
        )}
        confirmText={t('common.delete')}
        variant="danger"
        loading={deleting}
      />

      {/* Artifact Viewer Modal */}
      {viewingArtifact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={handleCloseViewer}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] mx-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              {(() => {
                const ViewerIcon = getArtifactIcon(
                  viewingArtifact.content_type,
                );
                return (
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${getIconClass(viewingArtifact.content_type)}`}
                  >
                    <ViewerIcon className="w-5 h-5 text-white" />
                  </div>
                );
              })()}
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {viewingArtifact.filename}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {viewingArtifact.content_type} |{' '}
                  {formatFileSize(viewingArtifact.file_size)}
                </p>
              </div>
              <button
                onClick={() => handleGoToProject(viewingArtifact.project_id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                title={t('artifacts.goToProject', 'Go to Project')}
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {t('artifacts.goToProject', 'Go to Project')}
                </span>
              </button>
              <button
                onClick={() => handleDownload(viewingArtifact)}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title={t('common.download', 'Download')}
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={handleCloseViewer}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title={t('common.close', 'Close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-5">
              {viewerLoading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t('common.loading', 'Loading...')}
                  </p>
                </div>
              ) : viewerError ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {viewerError}
                  </p>
                  <button
                    onClick={() => handleDownload(viewingArtifact)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {t('common.download', 'Download')}
                  </button>
                </div>
              ) : (viewingArtifact.content_type === 'application/pdf' ||
                  viewingArtifact.filename.toLowerCase().endsWith('.pdf')) &&
                viewerImageUrl ? (
                <iframe
                  src={viewerImageUrl}
                  title={viewingArtifact.filename}
                  className="w-full h-[70vh] rounded-lg border-0"
                />
              ) : viewingArtifact.content_type ===
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
                viewingArtifact.filename.toLowerCase().endsWith('.pptx') ? (
                <div className="flex flex-col h-[70vh]">
                  <p className="text-xs text-slate-400 dark:text-slate-500 text-center mb-2">
                    {t('artifacts.pptxNote')}
                  </p>
                  <div
                    ref={pptxContainerRef}
                    className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-800 rounded-lg p-4 [&_.pptx-wrapper]:flex [&_.pptx-wrapper]:flex-col [&_.pptx-wrapper]:items-center [&_.pptx-wrapper]:gap-6 [&_.pptx-slide]:shadow-xl [&_.pptx-slide]:rounded-lg [&_.pptx-slide]:overflow-hidden"
                  />
                </div>
              ) : (viewingArtifact.content_type ===
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                  viewingArtifact.filename.toLowerCase().endsWith('.docx')) &&
                viewerContent ? (
                <div
                  className="prose prose-sm prose-slate dark:prose-invert max-w-none [&_strong]:!text-inherit"
                  dangerouslySetInnerHTML={{ __html: viewerContent }}
                />
              ) : viewerImageUrl ? (
                <div className="flex items-center justify-center min-h-64 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <img
                    src={viewerImageUrl}
                    alt={viewingArtifact.filename}
                    className="max-w-full max-h-[60vh] object-contain"
                  />
                </div>
              ) : viewerContent ? (
                viewingArtifact.content_type === 'text/markdown' ||
                viewingArtifact.content_type === 'text/x-markdown' ||
                viewingArtifact.filename.endsWith('.md') ? (
                  <div className="prose prose-sm prose-slate dark:prose-invert max-w-none [&_strong]:!text-inherit">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                    >
                      {viewerContent}
                    </ReactMarkdown>
                  </div>
                ) : viewingArtifact.content_type === 'text/html' ? (
                  <div
                    className="prose prose-sm prose-slate dark:prose-invert max-w-none [&_strong]:!text-inherit"
                    dangerouslySetInnerHTML={{ __html: viewerContent }}
                  />
                ) : (
                  <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono bg-slate-50 dark:bg-slate-800 p-4 rounded-lg overflow-auto">
                    {viewerContent}
                  </pre>
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t('artifacts.noPreview', 'Preview not available')}
                  </p>
                  <button
                    onClick={() => handleDownload(viewingArtifact)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {t('common.download', 'Download')}
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {formatDate(viewingArtifact.created_at)}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                {viewingArtifact.project_id}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
