import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Loader2 } from 'lucide-react';

// Set worker source from local bundle
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfPageViewerProps {
  pdfUrl: string;
  pageNumber: number; // 1-indexed
  className?: string;
}

export default function PdfPageViewer({
  pdfUrl,
  pageNumber,
  className = '',
}: PdfPageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      if (!pdfUrl) return;

      setLoading(true);
      setError(null);

      try {
        // Cancel any existing render task
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        // Load PDF document (cache it)
        if (!pdfDocRef.current) {
          const loadingTask = pdfjsLib.getDocument({
            url: pdfUrl,
            cMapUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
            cMapPacked: true,
          });
          pdfDocRef.current = await loadingTask.promise;
        }

        if (cancelled) return;

        const pdfDoc = pdfDocRef.current;
        const page = await pdfDoc.getPage(pageNumber);

        if (cancelled) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate scale to fit container
        const containerWidth = container.clientWidth - 48; // padding
        const containerHeight = container.clientHeight - 48;
        const viewport = page.getViewport({ scale: 1 });

        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        const scale = Math.min(scaleX, scaleY, 2); // max 2x

        const scaledViewport = page.getViewport({ scale });

        // Set canvas size
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        // Render page
        const renderContext = {
          canvasContext: ctx,
          viewport: scaledViewport,
          canvas: canvas,
        };

        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;

        if (!cancelled) {
          setLoading(false);
        }
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
  }, [pdfUrl, pageNumber]);

  // Reset PDF doc when URL changes
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
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center ${className}`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
            <p className="text-sm text-slate-500">Loading PDF...</p>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`rounded-lg shadow-lg transition-opacity ${loading ? 'opacity-0' : 'opacity-100'}`}
      />
    </div>
  );
}
