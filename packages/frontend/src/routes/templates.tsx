import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Plus } from 'lucide-react';
import TemplateCard, { Template } from '../components/TemplateCard';
import TemplateUploadModal, {
  TemplateUploadData,
} from '../components/TemplateUploadModal';

export const Route = createFileRoute('/templates')({
  component: TemplatesPage,
});

// TODO: Replace with API data.
const MOCK_TEMPLATES: Template[] = [
  {
    template_id: 'tpl-001',
    name: 'Business Proposal Deck',
    description: 'Clean 16:9 slides with title, agenda, and section dividers.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&q=80',
    created_at: '2026-06-20T09:00:00Z',
  },
  {
    template_id: 'tpl-002',
    name: 'Quarterly Report',
    description: 'Data-heavy layout with charts, tables, and summary sections.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800&q=80',
    created_at: '2026-06-18T14:30:00Z',
  },
  {
    template_id: 'tpl-003',
    name: 'Product Overview',
    description: 'Slide layout with hero, features, and call to action.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&q=80',
    created_at: '2026-06-15T11:15:00Z',
  },
  {
    template_id: 'tpl-004',
    name: 'Technical Design Deck',
    description: 'Structured slides for architecture, APIs, and diagrams.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&q=80',
    created_at: '2026-06-10T08:45:00Z',
  },
  {
    template_id: 'tpl-005',
    name: 'Pitch Deck',
    description: 'Bold visual slides for storytelling and investor pitches.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&q=80',
    created_at: '2026-06-05T16:20:00Z',
  },
  {
    template_id: 'tpl-006',
    name: 'Team Update',
    description: 'Simple structured slides for agenda, status, and next steps.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800&q=80',
    created_at: '2026-06-01T10:00:00Z',
  },
];

function TemplatesPage() {
  const { t } = useTranslation();
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
              <TemplateCard key={template.template_id} template={template} />
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
