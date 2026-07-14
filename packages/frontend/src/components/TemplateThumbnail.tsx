import { FileText, Loader2 } from 'lucide-react';
import { useAuthImage } from '../hooks/useAuthImage';

interface TemplateThumbnailProps {
  /** Backend thumbnail path (Authorization-protected), or null when absent. */
  thumbnailUrl?: string | null;
  alt: string;
  className?: string;
}

/**
 * Renders a template thumbnail loaded from an Authorization-protected backend
 * path. The image is fetched as a signed blob and shown via an object URL;
 * falls back to a file icon when there is no thumbnail or loading fails.
 */
function TemplateThumbnail({
  thumbnailUrl,
  alt,
  className = 'w-full h-full object-cover',
}: TemplateThumbnailProps) {
  const { src, loading, error } = useAuthImage(thumbnailUrl);

  if (thumbnailUrl && loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 dark:bg-slate-800">
        <Loader2 className="w-6 h-6 text-slate-300 dark:text-slate-600 animate-spin" />
      </div>
    );
  }

  if (src && !error) {
    return <img src={src} alt={alt} loading="lazy" className={className} />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
      <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600" />
    </div>
  );
}

export default TemplateThumbnail;
