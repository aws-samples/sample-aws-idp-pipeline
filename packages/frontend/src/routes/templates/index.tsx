import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Plus } from 'lucide-react';
import TemplateCard from '../../components/TemplateCard';
import TemplateUploadModal, {
  TemplateUploadData,
} from '../../components/TemplateUploadModal';
import { useAwsClient } from '../../hooks/useAwsClient';
import { useTemplates } from '../../hooks/useTemplates';

export const Route = createFileRoute('/templates/')({
  component: TemplatesPage,
});

function TemplatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { fetchApi } = useAwsClient();
  const { templates, uploading, loadTemplates, uploadTemplate } = useTemplates({
    fetchApi,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleUpload = async (data: TemplateUploadData) => {
    await uploadTemplate(data);
    setShowUploadModal(false);
  };

  const filteredTemplates = templates.filter(
    (template) =>
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="min-h-screen bento-page">
      {/* Hero Section */}
      <header className="bento-hero">
        <div className="bento-hero-content">
          <div className="bento-hero-label">
            <span className="bento-hero-accent" />
            <span>{t('templates.heroTag')}</span>
          </div>
          <h1 className="bento-hero-title">{t('templates.heroTitle')}</h1>
          <p className="bento-hero-description">
            {t('templates.heroDescription')}
          </p>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('templates.searchPlaceholder')}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-transparent dark:bg-white/[0.06] border border-black/10 dark:border-white/[0.12] rounded-xl outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all text-slate-700 dark:text-slate-200"
          />
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 rounded-xl transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t('templates.newTemplate')}
        </button>
      </div>

      {/* Content */}
      <div className="pb-8">
        {filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="w-16 h-16 mb-4 text-slate-300 dark:text-slate-600" />
            <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t('templates.noTemplates')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
              {t('templates.noTemplatesDescription')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.template_id}
                template={template}
                onClick={(tpl) =>
                  navigate({
                    to: '/templates/$templateId',
                    params: { templateId: tpl.template_id },
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Upload Template Modal */}
      <TemplateUploadModal
        isOpen={showUploadModal}
        uploading={uploading}
        onClose={() => setShowUploadModal(false)}
        onUpload={handleUpload}
      />
    </div>
  );
}
