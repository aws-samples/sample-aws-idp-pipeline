import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
} from 'lucide-react';
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
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

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
                                onClick={() => handleDownload(artifact)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                              >
                                <Download className="w-4 h-4" />
                                {t('common.download', 'Download')}
                              </button>
                              <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                              <button
                                onClick={() => handleDeleteClick(artifact)}
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
    </div>
  );
}
