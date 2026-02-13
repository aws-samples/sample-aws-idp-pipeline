import { useTranslation } from 'react-i18next';
import './styles.css';

interface CubeLoaderProps {
  title?: string;
  description?: string;
}

export default function CubeLoader({ title, description }: CubeLoaderProps) {
  const { t } = useTranslation();

  return (
    <div className="loader-container">
      <div className="loader-dots">
        <span className="loader-dot" />
        <span className="loader-dot" />
        <span className="loader-dot" />
      </div>
      <div className="loader-text">
        <p className="loader-title">{title || t('common.loading')}</p>
        {description && <p className="loader-description">{description}</p>}
      </div>
    </div>
  );
}
