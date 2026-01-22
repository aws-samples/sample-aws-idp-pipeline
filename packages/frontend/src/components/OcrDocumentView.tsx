import { useState, useEffect, useRef, useCallback } from 'react';
import { OcrBlock, PaddleOcrBlocks } from '../types/project';

interface OcrDocumentViewProps {
  blocks: PaddleOcrBlocks | undefined;
  imageUrl: string | null;
}

// Visual block types that should show cropped images
const VISUAL_BLOCK_TYPES = ['figure', 'chart', 'seal', 'stamp', 'image'];

export default function OcrDocumentView({
  blocks,
  imageUrl,
}: OcrDocumentViewProps) {
  const [croppedImages, setCroppedImages] = useState<Map<number, string>>(
    new Map(),
  );
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Crop images from the original image using block bboxes
  const cropImages = useCallback(async () => {
    if (!imageUrl || !blocks?.blocks || !blocks.width || !blocks.height) {
      return;
    }

    const visualBlocks = blocks.blocks.filter((block) =>
      VISUAL_BLOCK_TYPES.includes(block.block_label),
    );

    if (visualBlocks.length === 0) {
      setImageLoaded(true);
      return;
    }

    // Load the image
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      imageRef.current = img;
      const newCroppedImages = new Map<number, string>();

      // Calculate scale factors (blocks.width and blocks.height are already validated above)
      const blockWidth = blocks.width ?? img.naturalWidth;
      const blockHeight = blocks.height ?? img.naturalHeight;
      const scaleX = img.naturalWidth / blockWidth;
      const scaleY = img.naturalHeight / blockHeight;

      visualBlocks.forEach((block) => {
        if (block.block_bbox && block.block_bbox.length === 4) {
          const [x1, y1, x2, y2] = block.block_bbox;

          // Scale bbox to actual image dimensions
          const cropX = Math.floor(x1 * scaleX);
          const cropY = Math.floor(y1 * scaleY);
          const cropWidth = Math.floor((x2 - x1) * scaleX);
          const cropHeight = Math.floor((y2 - y1) * scaleY);

          if (cropWidth > 0 && cropHeight > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = cropWidth;
            canvas.height = cropHeight;
            const ctx = canvas.getContext('2d');

            if (ctx) {
              ctx.drawImage(
                img,
                cropX,
                cropY,
                cropWidth,
                cropHeight,
                0,
                0,
                cropWidth,
                cropHeight,
              );

              try {
                const dataUrl = canvas.toDataURL('image/png');
                newCroppedImages.set(block.block_id, dataUrl);
              } catch {
                console.warn(
                  `Failed to crop image for block ${block.block_id}`,
                );
              }
            }
          }
        }
      });

      setCroppedImages(newCroppedImages);
      setImageLoaded(true);
    };

    img.onerror = () => {
      console.warn('Failed to load image for cropping');
      setImageLoaded(true);
    };

    img.src = imageUrl;
  }, [imageUrl, blocks]);

  useEffect(() => {
    cropImages();
  }, [cropImages]);

  // Render a single block
  const renderBlock = (block: OcrBlock) => {
    const isVisualBlock = VISUAL_BLOCK_TYPES.includes(block.block_label);
    const croppedSrc = croppedImages.get(block.block_id);

    // Skip empty non-visual blocks
    if (!isVisualBlock && !block.block_content?.trim()) {
      return null;
    }

    // Render visual blocks with cropped image
    if (isVisualBlock) {
      const [x1, , x2] = block.block_bbox || [0, 0, 0, 0];
      const width = x2 - x1;

      return (
        <div key={block.block_id} className="ocr-block ocr-block-visual my-4">
          {croppedSrc ? (
            <img
              src={croppedSrc}
              alt={`${block.block_label} #${block.block_id}`}
              style={{
                width: Math.min(width, 600),
                maxWidth: '100%',
                height: 'auto',
              }}
              className="rounded-lg shadow-md"
            />
          ) : (
            <div className="text-sm text-slate-400 italic">
              [{block.block_label.toUpperCase()}: Block #{block.block_id}]
            </div>
          )}
          {block.block_content?.trim() && (
            <p className="text-sm text-slate-500 italic mt-2">
              {block.block_content}
            </p>
          )}
        </div>
      );
    }

    // Render text blocks by type
    switch (block.block_label) {
      case 'doc_title':
        return (
          <h1
            key={block.block_id}
            className="text-2xl font-bold text-slate-900 dark:text-white mt-6 mb-4"
          >
            {block.block_content}
          </h1>
        );

      case 'paragraph_title':
        return (
          <h2
            key={block.block_id}
            className="text-xl font-semibold text-slate-800 dark:text-slate-100 mt-5 mb-3"
          >
            {block.block_content}
          </h2>
        );

      case 'header':
        return (
          <div
            key={block.block_id}
            className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2"
          >
            {block.block_content}
          </div>
        );

      case 'footer':
        return (
          <div
            key={block.block_id}
            className="text-xs text-slate-400 dark:text-slate-500 mt-4 pt-2 border-t border-slate-200 dark:border-slate-700"
          >
            {block.block_content}
          </div>
        );

      case 'table':
        return (
          <div
            key={block.block_id}
            className="ocr-block ocr-block-table my-4 overflow-x-auto"
          >
            <div
              className="prose prose-sm max-w-none prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:p-2 prose-td:border prose-td:border-slate-300 prose-td:p-2 dark:prose-th:border-slate-600 dark:prose-th:bg-slate-800 dark:prose-td:border-slate-600"
              dangerouslySetInnerHTML={{ __html: block.block_content }}
            />
          </div>
        );

      case 'text':
      default:
        return (
          <p
            key={block.block_id}
            className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-3"
          >
            {block.block_content}
          </p>
        );
    }
  };

  if (!blocks?.blocks || blocks.blocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <svg
          className="h-12 w-12 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm font-medium">No document blocks available</p>
      </div>
    );
  }

  // Sort blocks by block_order if available
  const sortedBlocks = [...blocks.blocks].sort((a, b) => {
    const orderA = a.block_order ?? a.block_id;
    const orderB = b.block_order ?? b.block_id;
    return orderA - orderB;
  });

  return (
    <div className="ocr-document-view">
      {!imageLoaded && imageUrl && (
        <div className="flex items-center justify-center py-8">
          <svg
            className="h-6 w-6 text-slate-400 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
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
          <span className="ml-2 text-sm text-slate-500">Loading images...</span>
        </div>
      )}
      <div className={imageLoaded || !imageUrl ? 'block' : 'hidden'}>
        {sortedBlocks.map((block) => renderBlock(block))}
      </div>
    </div>
  );
}
