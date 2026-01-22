import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { WorkflowDetail, AnalysisPopup } from '../types/project';
import { LANGUAGES, CARD_COLORS } from './ProjectSettingsModal';
import OcrDocumentView from './OcrDocumentView';

interface WorkflowDetailModalProps {
  workflow: WorkflowDetail;
  projectColor: number;
  loadingWorkflow: boolean;
  onClose: () => void;
}

export default function WorkflowDetailModal({
  workflow,
  projectColor,
  loadingWorkflow,
  onClose,
}: WorkflowDetailModalProps) {
  const { t } = useTranslation();
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState(false);
  const [analysisPopup, setAnalysisPopup] = useState<AnalysisPopup>({
    type: null,
    content: '',
    title: '',
    qaItems: [],
  });

  const currentSegment = workflow.segments[currentSegmentIndex];

  // Update analysisPopup content when segment changes
  useEffect(() => {
    setAnalysisPopup((prev) => {
      if (!prev.type) return prev;

      if (prev.type === 'ai') {
        const qaItems =
          currentSegment?.ai_analysis?.map((a) => ({
            question: a.analysis_query,
            answer: a.content,
          })) || [];
        return {
          ...prev,
          title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
          qaItems,
        };
      } else {
        // Determine which content type is being viewed from the title
        const contentType = prev.title.split(' ')[0]; // 'BDA', 'OCR', or 'PDF'
        const contentMap: Record<string, string> = {
          BDA: currentSegment?.bda_indexer || '',
          OCR: currentSegment?.paddleocr || '',
          PDF: currentSegment?.format_parser || '',
        };
        return {
          ...prev,
          content: contentMap[contentType] || '',
          title: `${contentType} Content - Segment ${currentSegmentIndex + 1}`,
        };
      }
    });
  }, [currentSegmentIndex, currentSegment]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div
        className="document-detail-modal bg-white rounded-2xl w-full max-w-7xl h-[90vh] flex overflow-hidden relative"
        style={
          {
            '--modal-glow-color':
              CARD_COLORS[projectColor]?.border || '#6366f1',
          } as React.CSSProperties
        }
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-white hover:bg-slate-100 rounded-lg transition-colors shadow-md"
        >
          <svg
            className="h-5 w-5 text-slate-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Left Panel - Document Details */}
        <div
          className={`bg-slate-50 flex flex-col border-r border-slate-200 transition-all duration-300 ${analysisPopup.type ? 'w-[600px]' : 'w-[400px]'}`}
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-slate-200 bg-white">
            <div className="p-2 bg-slate-200 rounded-lg">
              <svg
                className="h-5 w-5 text-slate-600"
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
            </div>
            <h2 className="text-base font-semibold text-slate-800">
              {t('workflow.documentDetails')}
            </h2>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {loadingWorkflow ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-slate-500">{t('common.loading')}</div>
              </div>
            ) : analysisPopup.type ? (
              /* Analysis Content View */
              <div className="flex flex-col h-full">
                {/* Navigation */}
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() =>
                      setAnalysisPopup({
                        type: null,
                        content: '',
                        title: '',
                        qaItems: [],
                      })
                    }
                    className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                    title={t('workflow.backToDetails')}
                  >
                    <svg
                      className="h-4 w-4 text-slate-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>
                  <div className="flex gap-1 flex-1">
                    {['BDA', 'OCR', 'PDF', 'AI']
                      .filter((type) => {
                        if (type === 'BDA')
                          return !!currentSegment?.bda_indexer;
                        if (type === 'OCR')
                          return (
                            !!currentSegment?.paddleocr ||
                            !!currentSegment?.paddleocr_blocks?.blocks?.length
                          );
                        if (type === 'PDF')
                          return !!currentSegment?.format_parser;
                        if (type === 'AI')
                          return (currentSegment?.ai_analysis?.length ?? 0) > 0;
                        return false;
                      })
                      .map((type) => (
                        <button
                          key={type}
                          onClick={() => {
                            if (type === 'AI') {
                              const qaItems =
                                currentSegment?.ai_analysis?.map((a) => ({
                                  question: a.analysis_query,
                                  answer: a.content,
                                })) || [];
                              setAnalysisPopup({
                                type: 'ai',
                                content: '',
                                title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
                                qaItems,
                              });
                            } else if (type === 'OCR') {
                              // Use document view if blocks exist, otherwise fallback to text
                              if (
                                currentSegment?.paddleocr_blocks?.blocks?.length
                              ) {
                                setAnalysisPopup({
                                  type: 'ocr',
                                  content: '',
                                  title: `OCR Content - Segment ${currentSegmentIndex + 1}`,
                                  qaItems: [],
                                });
                              } else {
                                setAnalysisPopup({
                                  type: 'ocr',
                                  content: currentSegment?.paddleocr || '',
                                  title: `OCR Content - Segment ${currentSegmentIndex + 1}`,
                                  qaItems: [],
                                });
                              }
                            } else {
                              const contentMap: Record<string, string> = {
                                BDA: currentSegment?.bda_indexer || '',
                                PDF: currentSegment?.format_parser || '',
                              };
                              setAnalysisPopup({
                                type: 'bda',
                                content: contentMap[type],
                                title: `${type} Content - Segment ${currentSegmentIndex + 1}`,
                                qaItems: [],
                              });
                            }
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            (type === 'AI' && analysisPopup.type === 'ai') ||
                            (type === 'OCR' && analysisPopup.type === 'ocr') ||
                            (type !== 'AI' &&
                              type !== 'OCR' &&
                              analysisPopup.title.includes(type))
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-sm font-semibold text-slate-800 mb-4">
                  {analysisPopup.title}
                </h3>

                {/* Content */}
                <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                  {analysisPopup.type === 'ocr' &&
                  currentSegment?.paddleocr_blocks?.blocks?.length ? (
                    <OcrDocumentView
                      blocks={currentSegment?.paddleocr_blocks}
                      imageUrl={currentSegment?.image_url}
                    />
                  ) : analysisPopup.type === 'ai' && analysisPopup.qaItems ? (
                    analysisPopup.qaItems.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
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
                            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <p className="text-sm font-medium">
                          {t('workflow.noAiAnalysis')}
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Question Navigator */}
                        <div className="flex-shrink-0 flex flex-wrap gap-2 mb-4 pb-3 border-b border-slate-200">
                          {analysisPopup.qaItems.map((_, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                document
                                  .getElementById(`qa-item-${idx}`)
                                  ?.scrollIntoView({ behavior: 'smooth' });
                              }}
                              className="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center transition-colors"
                            >
                              Q{idx + 1}
                            </button>
                          ))}
                        </div>

                        {/* Q&A Cards */}
                        <div className="flex-1 overflow-y-auto space-y-4">
                          {analysisPopup.qaItems.map((item, idx) => (
                            <div
                              key={idx}
                              id={`qa-item-${idx}`}
                              className="bg-white rounded-lg border border-slate-200 overflow-hidden scroll-mt-2"
                            >
                              {/* Question */}
                              <div className="bg-blue-50 border-b border-blue-100 px-4 py-3">
                                <div className="flex items-start gap-2">
                                  <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                    Q{idx + 1}
                                  </span>
                                  <p className="text-sm font-medium text-slate-800">
                                    {item.question}
                                  </p>
                                </div>
                              </div>
                              {/* Answer */}
                              <div className="px-4 py-3">
                                <div className="prose prose-slate prose-sm max-w-none prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:p-2 prose-td:border prose-td:border-slate-300 prose-td:p-2">
                                  <Markdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      img: ({ src, alt }) => (
                                        <img
                                          src={src}
                                          alt={alt || ''}
                                          className="max-w-full h-auto rounded-lg shadow-md my-4"
                                          loading="lazy"
                                        />
                                      ),
                                    }}
                                    urlTransform={(url) => url}
                                  >
                                    {item.answer}
                                  </Markdown>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )
                  ) : !analysisPopup.content ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
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
                      <p className="text-sm font-medium">
                        {t('workflow.noContent')}
                      </p>
                    </div>
                  ) : (
                    <div className="prose prose-slate prose-sm max-w-none prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:p-2 prose-td:border prose-td:border-slate-300 prose-td:p-2">
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          img: ({ src, alt }) => (
                            <img
                              src={src}
                              alt={alt || ''}
                              className="max-w-full h-auto rounded-lg shadow-md my-4"
                              loading="lazy"
                            />
                          ),
                        }}
                        urlTransform={(url) => url}
                      >
                        {analysisPopup.content}
                      </Markdown>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Basic Information */}
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">
                      {t('workflow.fileName')}
                    </p>
                    <p
                      className="text-sm text-slate-800 truncate"
                      title={workflow.file_name}
                    >
                      {workflow.file_name}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">
                        {t('workflow.fileType')}
                      </p>
                      <span className="inline-block px-2 py-1 bg-slate-200 text-slate-700 text-xs rounded">
                        {workflow.file_type || 'PDF'}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">
                        {t('workflow.totalSegments')}
                      </p>
                      <p className="text-sm text-slate-800">
                        {workflow.total_segments}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">
                      {t('workflow.analysisLanguage')}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs rounded font-medium">
                        {LANGUAGES.find(
                          (l) => l.code === (workflow.language || 'en'),
                        )?.flag || 'EN'}
                      </span>
                      <span className="text-sm text-slate-800">
                        {LANGUAGES.find(
                          (l) => l.code === (workflow.language || 'en'),
                        )?.name || 'English'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">
                      {t('workflow.status')}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      <span className="text-sm text-slate-800">
                        {workflow.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">
                      {t('workflow.created')}
                    </p>
                    <p className="text-sm text-slate-800">
                      {new Date(workflow.created_at).toLocaleString('ko-KR')}
                    </p>
                  </div>
                </div>

                <hr className="border-slate-200" />

                {/* Analysis Summary */}
                {workflow.segments.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-700 mb-4">
                      {t('workflow.segmentAnalysis', {
                        index: currentSegmentIndex + 1,
                      })}
                    </h3>
                    <p className="text-xs text-slate-400 mb-3">
                      {t('workflow.clickToView')}
                    </p>
                    <div className="flex gap-2">
                      {[
                        {
                          type: 'bda',
                          label: 'BDA',
                          content: currentSegment?.bda_indexer,
                        },
                        {
                          type: 'ocr',
                          label: 'OCR',
                          hasBlocks:
                            !!currentSegment?.paddleocr_blocks?.blocks?.length,
                          content:
                            currentSegment?.paddleocr ||
                            (currentSegment?.paddleocr_blocks?.blocks?.length
                              ? 'blocks'
                              : ''),
                        },
                        {
                          type: 'bda',
                          label: 'PDF',
                          content: currentSegment?.format_parser,
                        },
                      ].map(({ type, label, content, hasBlocks }) => (
                        <button
                          key={label}
                          onClick={() => {
                            if (content) {
                              if (type === 'ocr') {
                                setAnalysisPopup({
                                  type: 'ocr',
                                  content: hasBlocks ? '' : (content as string),
                                  title: `OCR Content - Segment ${currentSegmentIndex + 1}`,
                                  qaItems: [],
                                });
                              } else {
                                setAnalysisPopup({
                                  type: type as 'bda',
                                  content: content as string,
                                  title: `${label} Content - Segment ${currentSegmentIndex + 1}`,
                                  qaItems: [],
                                });
                              }
                            }
                          }}
                          disabled={!content}
                          className="flex-1 bg-white border border-slate-200 rounded-lg p-3 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <p className="text-xs text-slate-500">{label}</p>
                          <p className="text-lg font-semibold text-slate-800">
                            {content ? 1 : 0}
                          </p>
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          if (currentSegment?.ai_analysis?.length > 0) {
                            const qaItems = currentSegment.ai_analysis.map(
                              (a) => ({
                                question: a.analysis_query,
                                answer: a.content,
                              }),
                            );
                            setAnalysisPopup({
                              type: 'ai',
                              content: '',
                              title: `AI Analysis - Segment ${currentSegmentIndex + 1}`,
                              qaItems,
                            });
                          }
                        }}
                        disabled={!currentSegment?.ai_analysis?.length}
                        className="flex-1 bg-white border border-slate-200 rounded-lg p-3 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <p className="text-xs text-slate-500">AI</p>
                        <p className="text-lg font-semibold text-slate-800">
                          {currentSegment?.ai_analysis?.length || 0}
                        </p>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Image Viewer */}
        <div className="flex-1 flex flex-col bg-slate-100">
          {/* Segment Navigation */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setImageLoading(true);
                  setCurrentSegmentIndex((prev) => Math.max(0, prev - 1));
                }}
                disabled={currentSegmentIndex === 0}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg
                  className="h-4 w-4 text-slate-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>

              <select
                value={currentSegmentIndex}
                onChange={(e) => {
                  setImageLoading(true);
                  setCurrentSegmentIndex(Number(e.target.value));
                }}
                className="bg-white border border-slate-300 text-slate-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {workflow.segments.map((segment, idx) => (
                  <option key={idx} value={idx}>
                    {`${t('workflow.segment')} ${idx + 1}`}
                  </option>
                ))}
              </select>

              <span className="text-sm text-slate-500">
                {currentSegmentIndex + 1}/{workflow.total_segments}
              </span>

              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full border border-green-200">
                {workflow.status}
              </span>

              <button
                onClick={() => {
                  setImageLoading(true);
                  setCurrentSegmentIndex((prev) =>
                    Math.min(workflow.segments.length - 1, prev + 1),
                  );
                }}
                disabled={currentSegmentIndex >= workflow.segments.length - 1}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg
                  className="h-4 w-4 text-slate-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Media Display */}
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative">
            {workflow.segments.length === 0 ? (
              <div className="text-slate-500">{t('workflow.noSegments')}</div>
            ) : (
              (() => {
                const isVideoSegment =
                  currentSegment?.segment_type === 'VIDEO' ||
                  currentSegment?.segment_type === 'CHAPTER';

                if (isVideoSegment && currentSegment?.video_url) {
                  return (
                    <div className="w-full h-full flex items-center justify-center">
                      <video
                        key={currentSegment.video_url}
                        controls
                        className="max-w-full max-h-full rounded-lg shadow-lg"
                        preload="metadata"
                        src={currentSegment.video_url}
                      >
                        Your browser does not support video playback.
                      </video>
                    </div>
                  );
                }

                if (currentSegment?.image_url) {
                  return (
                    <>
                      {imageLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
                          <div className="flex flex-col items-center gap-3">
                            <svg
                              className="h-8 w-8 text-slate-400 animate-spin"
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
                            <p className="text-sm text-slate-500">
                              {t('workflow.loadingImage')}
                            </p>
                          </div>
                        </div>
                      )}
                      <img
                        src={currentSegment.image_url}
                        alt={`Segment ${currentSegmentIndex + 1}`}
                        className={`max-w-full max-h-full object-contain rounded-lg shadow-lg transition-opacity ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                        onLoad={() => setImageLoading(false)}
                      />
                    </>
                  );
                }

                return (
                  <div className="flex flex-col items-center gap-4 text-slate-400">
                    <svg
                      className="h-16 w-16"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <p>
                      {isVideoSegment
                        ? t('workflow.noVideoAvailable')
                        : t('workflow.noImageAvailable')}
                    </p>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
