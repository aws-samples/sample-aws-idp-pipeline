import { useEffect, useCallback } from 'react';

interface UseModalOptions {
  isOpen: boolean;
  onClose: () => void;
  disableClose?: boolean;
}

export function useModal({ isOpen, onClose, disableClose }: UseModalOptions) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disableClose) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose, disableClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !disableClose) {
        onClose();
      }
    },
    [onClose, disableClose],
  );

  return { handleBackdropClick };
}
