import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Loader2 } from 'lucide-react';
import { useDragPan } from '../hooks/useDragPan';

// Set worker source from local bundle
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfPageViewerProps {
  pdfUrl: string;
  pageNumber: number; // 1-indexed
  zoom?: number;
  className?: string;
}

export default function PdfPageViewer({
  pdfUrl,
  pageNumber,
  zoom = 1,
  className = '',
}: PdfPageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useDragPan<HTMLDivElement>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const renderPage = useCallback(
    async (pdfDoc: pdfjsLib.PDFDocumentProxy, currentZoom: number) => {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const page = await pdfDoc.getPage(pageNumber);

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const containerWidth = container.clientWidth - 48;
        const containerHeight = container.clientHeight - 48;
        const viewport = page.getViewport({ scale: 1 });

        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        const baseScale = Math.min(scaleX, scaleY, 2);

        const dpr = window.devicePixelRatio || 1;
        const scale = baseScale * currentZoom;
        const renderViewport = page.getViewport({ scale: scale * dpr });

        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        canvas.style.width = `${renderViewport.width / dpr}px`;
        canvas.style.height = `${renderViewport.height / dpr}px`;

        renderTaskRef.current = page.render({
          canvasContext: ctx,
          viewport: renderViewport,
          canvas: canvas,
        });
        await renderTaskRef.current.promise;
        setLoading(false);
      } catch (err: unknown) {
        if (err instanceof Error && err.message?.includes('cancelled')) return;
        console.error('PDF render error:', err);
        setError('Failed to load PDF page');
        setLoading(false);
      }
    },
    [pageNumber],
  );

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      if (!pdfUrl) return;

      setLoading(true);
      setError(null);

      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        if (!pdfDocRef.current) {
          pdfDocRef.current = await pdfjsLib.getDocument({
            url: pdfUrl,
            cMapUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/standard_fonts/`,
            enableXfa: true,
          }).promise;
        }

        if (cancelled) return;
        await renderPage(pdfDocRef.current, zoom);
      } catch (err) {
        if (!cancelled) {
          console.error('PDF render error:', err);
          setError('Failed to load PDF page');
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfUrl, pageNumber, zoom, renderPage]);

  useEffect(() => {
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfUrl]);

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-white/[0.04] z-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
            <p className="text-sm text-slate-500">Loading PDF...</p>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className={`flex-1 overflow-auto ${zoom > 1 ? 'cursor-grab' : ''}`}
      >
        <div className="inline-flex min-w-full min-h-full items-center justify-center">
          <canvas
            ref={canvasRef}
            className={`rounded-lg shadow-lg transition-opacity ${loading ? 'opacity-0' : 'opacity-100'}`}
          />
        </div>
      </div>
    </div>
  );
}
