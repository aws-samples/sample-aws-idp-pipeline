import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Plus } from 'lucide-react';
import TemplateCard from '../../components/TemplateCard';
import TemplateUploadModal, {
  TemplateUploadData,
} from '../../components/TemplateUploadModal';
import { MOCK_TEMPLATES } from '../../types/template';

export const Route = createFileRoute('/templates/')({
  component: TemplatesPage,
});

function TemplatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (data: TemplateUploadData) => {
    setUploading(true);
    // TODO: Replace with API call.
    console.log('Upload template:', data);
    await new Promise((resolve) => setTimeout(resolve, 800));
    setUploading(false);
    setShowUploadModal(false);
    // TODO: On success, navigate to the created template's detail page
    // (analyzing state) e.g. navigate({ to: '/templates/$templateId',
    // params: { templateId: created.template_id } });
  };

  const filteredTemplates = MOCK_TEMPLATES.filter(
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
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
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
      </div>

      {/* Content */}
      <div className="pb-8">
        {filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="w-16 h-16 mb-4 text-slate-300 dark:text-slate-600" />
            <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t('templates.noTemplates')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md mb-6">
              {t('templates.noTemplatesDescription')}
            </p>
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('templates.newTemplate')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {/* New Template Card */}
            <button
              onClick={() => setShowUploadModal(true)}
              className="template-card-new group flex flex-col items-center justify-center gap-3 aspect-[4/3] rounded-2xl border-2 border-dashed border-black/15 dark:border-white/15 text-slate-400 hover:border-blue-500/50 hover:text-blue-500 transition-colors"
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/5 group-hover:bg-blue-500/10 transition-colors">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium">
                {t('templates.newTemplate')}
              </span>
            </button>

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
