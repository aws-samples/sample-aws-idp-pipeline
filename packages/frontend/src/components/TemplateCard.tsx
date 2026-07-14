import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import TemplateThumbnail from './TemplateThumbnail';

export interface Template {
  template_id: string;
  name: string;
  description: string;
  template_type?: string | null;
  thumbnail_url?: string | null;
  status?: string;
  created_at: string;
}

const TEMPLATE_TYPE_BADGE: Record<string, string> = {
  pptx: 'bg-orange-500/90',
  ppt: 'bg-orange-500/90',
  docx: 'bg-blue-500/90',
  doc: 'bg-blue-500/90',
};

interface TemplateCardProps {
  template: Template;
  onClick?: (template: Template) => void;
}

function TemplateCard({ template, onClick }: TemplateCardProps) {
  const { i18n } = useTranslation();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(i18n.language || 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div
      className="template-card group cursor-pointer overflow-hidden rounded-2xl border border-black/10 dark:border-white/[0.12] bg-white/40 dark:bg-white/[0.04] backdrop-blur-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:border-blue-500/40"
      onClick={() => onClick?.(template)}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-800">
        <TemplateThumbnail
          thumbnailUrl={template.thumbnail_url}
          alt={template.name}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {template.template_type && (
          <span
            className={`absolute top-3 left-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white rounded-md ${
              TEMPLATE_TYPE_BADGE[template.template_type] ?? 'bg-slate-500/90'
            }`}
          >
            {template.template_type}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start gap-2">
          <FileText className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-tight line-clamp-1">
            {template.name}
          </h3>
        </div>
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[2rem]">
          {template.description}
        </p>
        <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {formatDate(template.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TemplateCard;
