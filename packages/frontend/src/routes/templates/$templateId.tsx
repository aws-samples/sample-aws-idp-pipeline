import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  FileText,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Trash2,
  Download,
} from 'lucide-react';
import type { TemplateDetail, TemplateStatus } from '../../types/template';
import { useAwsClient } from '../../hooks/useAwsClient';
import CubeLoader from '../../components/CubeLoader';
import ConfirmModal from '../../components/ConfirmModal';

export const Route = createFileRoute('/templates/$templateId')({
  component: TemplateDetailPage,
});

// 'uploading' has no dedicated visual; it is shown as the analyzing state.
const isAnalyzing = (status: TemplateStatus) =>
  status === 'uploading' || status === 'analyzing';

function StatusBadge({ status }: { status: TemplateStatus }) {
  const { t } = useTranslation();

  if (isAnalyzing(status)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t('templateDetail.statusAnalyzing')}
      </span>
    );
  }

  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        <Check className="w-3 h-3" />
        {t('templateDetail.statusCompleted')}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">
      {t('templateDetail.statusFailed')}
    </span>
  );
}

function TemplateDetailPage() {
  const { t, i18n } = useTranslation();
  const { templateId } = Route.useParams();
  const { fetchApi } = useAwsClient();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const loadTemplate = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<TemplateDetail>(`templates/${templateId}`);
      setTemplate(data);
    } catch (error) {
      console.error('Failed to load template:', error);
      setTemplate(null);
    }
    setLoading(false);
  }, [fetchApi, templateId]);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  if (loading) {
    return (
      <div className="bento-loading">
        <CubeLoader />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-screen">
        <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600" />
        <div className="text-slate-500 dark:text-slate-400">
          {t('templateDetail.notFound')}
        </div>
        <Link
          to="/templates"
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-sm"
        >
          {t('templateDetail.backToList')}
        </Link>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(i18n.language ?? 'en', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleCopyPrompt = async () => {
    if (!template.generated_prompt) return;
    await navigator.clipboard.writeText(template.generated_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    // TODO: Replace with API call
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setReanalyzing(false);
  };

  const handleDelete = async () => {
    // TODO: Replace with API call
    console.log('Delete template:', templateId);
    setShowDeleteModal(false);
  };

  return (
    <div className="min-h-screen bento-page">
      {/* Back navigation */}
      <div className="mb-6">
        <Link
          to="/templates"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('templateDetail.backToList')}
        </Link>
      </div>

      {/* Template header */}
      <div className="flex flex-col lg:flex-row gap-6 mb-8">
        {/* Thumbnail */}
        <div className="w-full lg:w-80 flex-shrink-0">
          <div className="aspect-[4/3] rounded-2xl overflow-hidden border border-black/10 dark:border-white/[0.12] bg-slate-100 dark:bg-slate-800">
            {template.thumbnail_url ? (
              <img
                src={template.thumbnail_url}
                alt={template.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
                <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600" />
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 mb-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white truncate">
              {template.name}
            </h1>
            <StatusBadge status={template.status} />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 max-w-2xl">
            {template.description}
          </p>

          {/* Info row */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mb-6">
            {template.template_type && (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-medium uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">
                  {template.template_type}
                </span>
              </span>
            )}
            <span>{formatDate(template.created_at)}</span>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 border border-black/10 dark:border-white/[0.12] rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors">
              <Download className="w-3.5 h-3.5" />
              {t('common.download')}
            </button>
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 border border-black/10 dark:border-white/[0.12] rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-50"
            >
              {reanalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {t('templateDetail.reanalyze')}
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('common.delete')}
            </button>
          </div>
        </div>
      </div>

      {/* Generated Prompt Section */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t('templateDetail.generatedPrompt')}
          </h2>
          {template.generated_prompt && (
            <button
              onClick={handleCopyPrompt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-black/10 dark:border-white/[0.12] rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  {t('common.copied')}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  {t('common.copy')}
                </>
              )}
            </button>
          )}
        </div>

        {isAnalyzing(template.status) && (
          <div className="flex items-center gap-3 p-6 rounded-xl border border-black/10 dark:border-white/[0.12] bg-white/40 dark:bg-white/[0.04]">
            <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('templateDetail.analyzingTitle')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('templateDetail.analyzingDescription')}
              </p>
            </div>
          </div>
        )}

        {template.status === 'failed' && (
          <div className="flex items-center justify-between p-6 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5">
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                {t('templateDetail.failedTitle')}
              </p>
              <p className="text-xs text-red-600/70 dark:text-red-400/60 mt-0.5">
                {t('templateDetail.failedDescription')}
              </p>
            </div>
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {reanalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {t('templateDetail.retry')}
            </button>
          </div>
        )}

        {template.status === 'completed' && template.generated_prompt && (
          <div className="rounded-xl border border-black/10 dark:border-white/[0.12] bg-white/40 dark:bg-white/[0.04] overflow-hidden">
            <pre className="p-5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto">
              {template.generated_prompt}
            </pre>
          </div>
        )}
      </section>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title={t('templateDetail.deleteConfirmTitle')}
        message={t('templateDetail.deleteConfirmMessage', {
          name: template.name,
        })}
        confirmText={t('common.delete')}
        variant="danger"
      />
    </div>
  );
}
