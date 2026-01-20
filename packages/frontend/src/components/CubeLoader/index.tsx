import { useTranslation } from 'react-i18next';
import './styles.css';

interface CubeLoaderProps {
  title?: string;
  description?: string;
}

export default function CubeLoader({ title, description }: CubeLoaderProps) {
  const { t } = useTranslation();

  return (
    <div className="cube-loader-container">
      {/* 3D Scene Wrapper */}
      <div className="cube-scene">
        {/* THE SPINNING CUBE CONTAINER */}
        <div className="cube-wrapper">
          {/* Internal Core (The energy source) */}
          <div className="cube-core" />

          {/* CUBE FACES */}
          <div className="side-wrapper front">
            <div className="face face-cyan" />
          </div>
          <div className="side-wrapper back">
            <div className="face face-cyan" />
          </div>
          <div className="side-wrapper right">
            <div className="face face-purple" />
          </div>
          <div className="side-wrapper left">
            <div className="face face-purple" />
          </div>
          <div className="side-wrapper top">
            <div className="face face-indigo" />
          </div>
          <div className="side-wrapper bottom">
            <div className="face face-indigo" />
          </div>
        </div>

        {/* Floor Shadow */}
        <div className="cube-shadow" />
      </div>

      {/* Loading Text */}
      <div className="cube-loader-text">
        <h3 className="cube-loader-title">{title || t('common.loading')}</h3>
        <p className="cube-loader-description">
          {description || t('common.loadingDescription')}
        </p>
      </div>
    </div>
  );
}
