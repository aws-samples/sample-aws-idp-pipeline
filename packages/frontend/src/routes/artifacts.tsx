import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Code,
  Table,
  BarChart3,
  FileText,
  Image,
  Search,
  MoreVertical,
  Copy,
  Download,
  Trash2,
  Layers,
  Check,
  Folder,
} from 'lucide-react';
import { Artifact, ArtifactType } from '../types/project';
import ConfirmModal from '../components/ConfirmModal';

export const Route = createFileRoute('/artifacts')({
  component: ArtifactsPage,
});

const artifactIcons: Record<ArtifactType, typeof Code> = {
  code: Code,
  table: Table,
  chart: BarChart3,
  markdown: FileText,
  image: Image,
};

const artifactIconClasses: Record<ArtifactType, string> = {
  code: 'artifact-icon-code',
  table: 'artifact-icon-table',
  chart: 'artifact-icon-chart',
  markdown: 'artifact-icon-markdown',
  image: 'artifact-icon-image',
};

// Sample data for preview
const sampleArtifacts: Artifact[] = [
  {
    artifact_id: '1',
    session_id: 'session-1',
    project_id: 'proj-1',
    project_name: 'IDP Platform',
    type: 'code',
    title: 'API Response Handler',
    language: 'typescript',
    content: `async function handleApiResponse<T>(
  response: Response
): Promise<T> {
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }
  return response.json();
}`,
    created_at: '2025-01-22T10:30:00Z',
  },
  {
    artifact_id: '2',
    session_id: 'session-1',
    project_id: 'proj-1',
    project_name: 'IDP Platform',
    type: 'markdown',
    title: 'Project Documentation',
    content: `# Project Overview

This document describes the architecture and key components of our IDP system.

## Features
- Document analysis with AI
- Vector search capabilities
- Real-time processing updates

## Getting Started
1. Clone the repository
2. Install dependencies
3. Configure environment variables`,
    created_at: '2025-01-22T09:15:00Z',
  },
  {
    artifact_id: '3',
    session_id: 'session-2',
    project_id: 'proj-2',
    project_name: 'Sales Dashboard',
    type: 'table',
    title: 'Sales Report Q4 2024',
    content: `| Month | Revenue | Growth |
|-------|---------|--------|
| Oct   | $125K   | +12%   |
| Nov   | $142K   | +13%   |
| Dec   | $168K   | +18%   |`,
    created_at: '2025-01-21T14:20:00Z',
  },
  {
    artifact_id: '4',
    session_id: 'session-2',
    project_id: 'proj-2',
    project_name: 'Sales Dashboard',
    type: 'code',
    title: 'Database Query',
    language: 'sql',
    content: `SELECT
  u.name,
  COUNT(o.id) as order_count,
  SUM(o.total) as total_spent
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE o.created_at >= '2024-01-01'
GROUP BY u.id
ORDER BY total_spent DESC
LIMIT 10;`,
    created_at: '2025-01-21T11:45:00Z',
  },
  {
    artifact_id: '5',
    session_id: 'session-3',
    project_id: 'proj-3',
    project_name: 'Architecture Docs',
    type: 'image',
    title: 'System Architecture Diagram',
    content: '[Image: System architecture showing microservices layout]',
    created_at: '2025-01-20T16:30:00Z',
  },
  {
    artifact_id: '6',
    session_id: 'session-3',
    project_id: 'proj-3',
    project_name: 'Architecture Docs',
    type: 'chart',
    title: 'User Growth Analysis',
    content: `{
  "type": "line",
  "data": {
    "labels": ["Jan", "Feb", "Mar", "Apr"],
    "datasets": [{
      "label": "Active Users",
      "data": [1200, 1900, 3000, 5000]
    }]
  }
}`,
    created_at: '2025-01-20T10:00:00Z',
  },
];

function ArtifactsPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [artifacts] = useState<Artifact[]>(sampleArtifacts);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [artifactToDelete, setArtifactToDelete] = useState<Artifact | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredArtifacts = artifacts.filter(
    (artifact) =>
      artifact.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      artifact.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      artifact.project_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (artifact.language &&
        artifact.language.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const handleMenuToggle = (artifactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === artifactId ? null : artifactId);
  };

  const handleCopy = async (artifact: Artifact) => {
    await navigator.clipboard.writeText(artifact.content);
    setOpenMenuId(null);
    setCopiedId(artifact.artifact_id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownload = (artifact: Artifact) => {
    const extensions: Record<ArtifactType, string> = {
      code: artifact.language || 'txt',
      markdown: 'md',
      table: 'md',
      chart: 'json',
      image: 'txt',
    };
    const blob = new Blob([artifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title}.${extensions[artifact.type]}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setOpenMenuId(null);
  };

  const handleDeleteClick = (artifact: Artifact) => {
    setOpenMenuId(null);
    setArtifactToDelete(artifact);
  };

  const handleConfirmDelete = async () => {
    if (!artifactToDelete) return;
    // TODO: Call delete API
    console.log('Delete artifact:', artifactToDelete.artifact_id);
    setArtifactToDelete(null);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bento-page">
      {/* Hero Section */}
      <header className="bento-hero">
        <div className="bento-hero-content">
          <div className="bento-hero-label">
            <span className="bento-hero-accent" />
            <span>{t('artifacts.heroTag', 'AI Generated Artifacts')}</span>
          </div>
          <h1 className="bento-hero-title">
            {t(
              'artifacts.heroTitle',
              'Code, documents, and insights generated by AI',
            )}
          </h1>
          <p className="bento-hero-description">
            {t(
              'artifacts.heroDescription',
              'Browse and manage all artifacts created during your conversations.\nQuickly copy, download, or organize your generated content.',
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
            placeholder={t(
              'artifacts.searchPlaceholder',
              'Search artifacts...',
            )}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all"
          />
        </div>

        {/* Count */}
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
          <Layers className="w-4 h-4" />
          <span>
            {filteredArtifacts.length} {t('artifacts.items', 'items')}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="pb-8">
        {filteredArtifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Layers className="w-16 h-16 mb-4 text-slate-300 dark:text-slate-600" />
            <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t('artifacts.noArtifacts', 'No artifacts yet')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
              {t(
                'artifacts.noArtifactsDescription',
                'Artifacts generated during chat conversations will appear here.',
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredArtifacts.map((artifact) => {
              const ArtifactIcon = artifactIcons[artifact.type] || Layers;
              const iconClass = artifactIconClasses[artifact.type];
              return (
                <div
                  key={artifact.artifact_id}
                  data-type={artifact.type}
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
                        <div>
                          <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-tight">
                            {artifact.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                              {artifact.type}
                            </span>
                            {artifact.language && (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">
                                  |
                                </span>
                                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                                  {artifact.language}
                                </span>
                              </>
                            )}
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
                              onClick={() => handleCopy(artifact)}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                            >
                              {copiedId === artifact.artifact_id ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                              {copiedId === artifact.artifact_id
                                ? t('common.copied', 'Copied!')
                                : t('common.copy', 'Copy')}
                            </button>
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

                    {/* Preview */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 mb-4 max-h-36 overflow-hidden relative">
                      <pre className="text-xs text-slate-600 dark:text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
                        {artifact.content.slice(0, 300)}
                        {artifact.content.length > 300 && '...'}
                      </pre>
                      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-slate-50 dark:from-slate-800/50 to-transparent" />
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                          <Folder className="w-3 h-3" />
                          <span className="truncate max-w-[100px]">
                            {artifact.project_name}
                          </span>
                        </span>
                        <span className="text-xs text-slate-300 dark:text-slate-600">
                          |
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {formatDate(artifact.created_at)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopy(artifact)}
                        className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                      >
                        {copiedId === artifact.artifact_id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-500" />
                            <span className="text-green-500">
                              {t('common.copied', 'Copied!')}
                            </span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{t('common.copy', 'Copy')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!artifactToDelete}
        onClose={() => setArtifactToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('chat.deleteArtifact', 'Delete Artifact')}
        message={t(
          'chat.deleteArtifactConfirm',
          'Are you sure you want to delete this artifact? This action cannot be undone.',
        )}
        confirmText={t('common.delete')}
        variant="danger"
      />
    </div>
  );
}
