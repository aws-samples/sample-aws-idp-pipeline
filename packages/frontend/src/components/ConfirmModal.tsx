import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trash2, Info, X } from 'lucide-react';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  transparentBackdrop?: boolean;
}

const variantStyles: Record<
  ConfirmVariant,
  {
    icon: typeof AlertTriangle;
    iconBg: string;
    iconColor: string;
    buttonBg: string;
    borderColor: string;
    glowColor: string;
  }
> = {
  danger: {
    icon: Trash2,
    iconBg: 'bg-red-100 dark:bg-red-500/10',
    iconColor: 'text-red-600 dark:text-red-400',
    buttonBg: 'bg-red-600 hover:bg-red-500',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    glowColor: 'rgba(239, 68, 68, 0.08)',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-100 dark:bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400',
    buttonBg: 'bg-amber-600 hover:bg-amber-500',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    glowColor: 'rgba(245, 158, 11, 0.08)',
  },
  info: {
    icon: Info,
    iconBg: 'bg-blue-100 dark:bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
    buttonBg: 'bg-blue-600 hover:bg-blue-500',
    borderColor: 'rgba(59, 130, 246, 0.3)',
    glowColor: 'rgba(59, 130, 246, 0.08)',
  },
};

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'danger',
  loading = false,
  transparentBackdrop = false,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  const styles = variantStyles[variant];
  const Icon = styles.icon;

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose, loading]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200 ${
        transparentBackdrop
          ? ''
          : 'bg-black/40 dark:bg-black/60 backdrop-blur-sm'
      }`}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
        style={{
          border: `1px solid ${styles.borderColor}`,
          boxShadow: `0 0 40px ${styles.glowColor}, 0 25px 50px -12px rgba(0, 0, 0, 0.15)`,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors disabled:opacity-50 z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="relative p-8">
          {/* Icon */}
          <div
            className={`w-14 h-14 mx-auto mb-5 rounded-xl flex items-center justify-center ${styles.iconBg}`}
          >
            <Icon className={`w-7 h-7 ${styles.iconColor}`} />
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-center text-slate-900 dark:text-white mb-2">
            {title}
          </h3>

          {/* Message */}
          <p className="text-sm text-center text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">
            {message}
          </p>

          {/* Spacer */}
          <div className="h-12" />

          {/* Buttons */}
          <div className="flex gap-4">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-5 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-xl transition-all disabled:opacity-50"
            >
              {cancelText || t('common.cancel')}
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className={`flex-1 px-5 py-3 text-sm font-medium text-white rounded-xl transition-all disabled:opacity-50 ${styles.buttonBg}`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>{t('common.loading')}</span>
                </span>
              ) : (
                confirmText || t('common.confirm')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
