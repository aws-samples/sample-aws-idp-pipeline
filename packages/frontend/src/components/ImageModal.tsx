import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ZoomIn, ZoomOut, Download, Maximize2 } from 'lucide-react';

interface ImageModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export default function ImageModal({ src, alt, onClose }: ImageModalProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  const minScale = 0.5;
  const maxScale = 5;
  const scaleStep = 0.5;

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + scaleStep, maxScale));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - scaleStep, minScale));
  }, []);

  const handleReset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleDownload = useCallback(() => {
    // Extract filename from alt or generate one
    const filename = alt || `image-${Date.now()}`;
    const extension = filename.includes('.') ? '' : '.png';

    const downloadBlob = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename + extension;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    // Try fetch with CORS first
    fetch(src, { mode: 'cors', cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('Fetch failed');
        return res.blob();
      })
      .then(downloadBlob)
      .catch(() => {
        // Fallback: try loading image with CORS and canvas
        const corsImg = new Image();
        corsImg.crossOrigin = 'anonymous';

        corsImg.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = corsImg.naturalWidth;
          canvas.height = corsImg.naturalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            window.open(src, '_blank');
            return;
          }

          ctx.drawImage(corsImg, 0, 0);

          canvas.toBlob((blob) => {
            if (!blob) {
              window.open(src, '_blank');
              return;
            }
            downloadBlob(blob);
          }, 'image/png');
        };

        corsImg.onerror = () => {
          window.open(src, '_blank');
        };

        // Add cache buster to avoid cached non-CORS response
        const cacheBuster = src.includes('?') ? '&_cb=' : '?_cb=';
        corsImg.src = src + cacheBuster + Date.now();
      });
  }, [src, alt]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case '+':
        case '=':
          handleZoomIn();
          break;
        case '-':
          handleZoomOut();
          break;
        case '0':
          handleReset();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleZoomIn, handleZoomOut, handleReset]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -scaleStep : scaleStep;
    setScale((prev) => Math.min(Math.max(prev + delta, minScale), maxScale));
  }, []);

  // Drag handling
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale > 1) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      }
    },
    [scale, position],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Toolbar */}
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/20 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleZoomOut}
          disabled={scale <= minScale}
          className="p-2 rounded-full hover:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom out (-)"
        >
          <ZoomOut className="w-5 h-5 text-white" />
        </button>
        <span className="px-3 text-sm font-medium text-white min-w-[4rem] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          disabled={scale >= maxScale}
          className="p-2 rounded-full hover:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom in (+)"
        >
          <ZoomIn className="w-5 h-5 text-white" />
        </button>
        <div className="w-px h-6 bg-white/30 mx-1" />
        <button
          onClick={handleReset}
          className="p-2 rounded-full hover:bg-white/20 transition-colors"
          title="Reset (0)"
        >
          <Maximize2 className="w-5 h-5 text-white" />
        </button>
        <button
          onClick={handleDownload}
          className="p-2 rounded-full hover:bg-white/20 transition-colors"
          title="Download"
        >
          <Download className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2.5 rounded-full bg-black/60 hover:bg-black/80 border border-white/30 transition-colors z-10 shadow-lg"
        title="Close (Esc)"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {/* Image container */}
      <div
        className="relative max-w-[75vw] max-h-[75vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="max-w-[75vw] max-h-[75vh] object-contain select-none"
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
          draggable={false}
        />
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/50">
        Scroll to zoom | Drag to pan | Esc to close
      </div>
    </div>
  );
}
