import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface UsePdfPageImageResult {
  imageUrl: string | null;
  loading: boolean;
  error: string | null;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Hook that renders a PDF page to an off-screen canvas and returns it as a data URL.
 * This allows PDF pages to be displayed using a regular <img> tag with zoom/pan support.
 */
export function usePdfPageImage(
  pdfUrl: string | null,
  pageNumber: number,
): UsePdfPageImageResult {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const prevPdfUrl = useRef<string | null>(null);

  const renderPageToImage = useCallback(
    async (pdfDoc: pdfjsLib.PDFDocumentProxy) => {
      const page = await pdfDoc.getPage(pageNumber);
      const dpr = window.devicePixelRatio || 1;
      const scale = 2 * dpr;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

      setNaturalWidth(viewport.width / dpr);
      setNaturalHeight(viewport.height / dpr);

      return canvas.toDataURL('image/png');
    },
    [pageNumber],
  );

  useEffect(() => {
    if (!pdfUrl) {
      setImageUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (prevPdfUrl.current !== pdfUrl) {
          if (pdfDocRef.current) {
            pdfDocRef.current.destroy();
            pdfDocRef.current = null;
          }
          prevPdfUrl.current = pdfUrl;
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

        const dataUrl = await renderPageToImage(pdfDocRef.current);
        if (!cancelled) {
          setImageUrl(dataUrl);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('PDF page render error:', err);
          setError('Failed to render PDF page');
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl, pageNumber, renderPageToImage]);

  useEffect(() => {
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, []);

  return { imageUrl, loading, error, naturalWidth, naturalHeight };
}
