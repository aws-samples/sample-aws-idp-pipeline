import { useMemo } from 'react';
import { X, Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useModal } from '../hooks/useModal';
import GraphView from './GraphView/GraphView';
import { GRAPH_BG } from './GraphView/constants';
import type { GraphData } from './GraphView/useGraphData';
import type { GraphSearchResult } from './ChatPanel/types';

interface GraphSearchResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: GraphSearchResult;
}

function toGraphData(result: GraphSearchResult): GraphData {
  const nodes: GraphData['nodes'] = [];
  const edges: GraphData['edges'] = [];
  const docIds = new Set<string>();
  const segKeys = new Set<string>();

  // Entity nodes
  for (const entity of result.entities) {
    nodes.push({
      id: `entity-${entity.name}`,
      label: entity.name,
      type: 'entity',
      properties: { entity_type: entity.type },
    });
  }

  // Analysis, Segment, Document nodes + structural edges
  for (const source of result.sources) {
    const qaId = source.qa_id || source.segment_id;
    const qaIdx = source.qa_index ?? 0;
    const segKey = `${source.document_id}_${source.segment_index}`;

    // Analysis node
    nodes.push({
      id: `qa-${qaId}`,
      label: `QA ${qaIdx}`,
      type: 'analysis',
      properties: { segment_index: source.segment_index, qa_index: qaIdx },
    });

    // Analysis -> Segment
    edges.push({
      source: `qa-${qaId}`,
      target: `seg-${segKey}`,
      label: 'BELONGS_TO',
      properties: null,
    });

    // Segment node (deduplicate)
    if (!segKeys.has(segKey)) {
      segKeys.add(segKey);
      nodes.push({
        id: `seg-${segKey}`,
        label: `Page ${source.segment_index + 1}`,
        type: 'segment',
        properties: {
          segment_index: source.segment_index,
          document_id: source.document_id,
        },
      });
      // Segment -> Document
      edges.push({
        source: `seg-${segKey}`,
        target: `doc-${source.document_id}`,
        label: 'BELONGS_TO',
        properties: null,
      });
    }

    // Document node (deduplicate)
    if (!docIds.has(source.document_id)) {
      docIds.add(source.document_id);
      nodes.push({
        id: `doc-${source.document_id}`,
        label: 'Document',
        type: 'document',
        properties: {},
      });
    }
  }

  // Entity -> Analysis edges
  for (const entity of result.entities) {
    for (const source of result.sources) {
      const qaId = source.qa_id || source.segment_id;
      edges.push({
        source: `entity-${entity.name}`,
        target: `qa-${qaId}`,
        label: 'MENTIONED_IN',
        properties: null,
      });
    }
  }

  return { nodes, edges };
}

export default function GraphSearchResultModal({
  isOpen,
  onClose,
  data,
}: GraphSearchResultModalProps) {
  const { t } = useTranslation();
  useModal({ isOpen, onClose });

  const graphData = useMemo(() => toGraphData(data), [data]);

  if (!isOpen) return null;

  const hasAnswer = !!data.answer;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-7xl mx-4 rounded-2xl border border-slate-200 dark:border-blue-500/30 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 bg-white dark:bg-transparent"
        style={{ height: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-200 dark:border-blue-500/20 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-blue-900/30 dark:to-indigo-900/30">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-sm">
            <Network className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-blue-200">
            {t('chat.graphSearchResult', 'Knowledge Graph')}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {data.entities.length} {t('chat.entities', 'entities')},{' '}
            {data.sources.length} {t('chat.segments', 'segments')}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-blue-800/40 transition-colors"
          >
            <X className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Content: split or graph only */}
        <div
          className={hasAnswer ? 'flex' : ''}
          style={{ height: 'calc(85vh - 52px)' }}
        >
          {/* Left: Answer content */}
          {hasAnswer && (
            <div className="w-2/5 border-r border-black/[0.08] dark:border-blue-500/20 overflow-y-auto p-5 bg-[#e8ecf4]/90 dark:bg-slate-900">
              {/* Entity chips */}
              {data.entities?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {data.entities.map((entity, i) => (
                    <span
                      key={i}
                      className="text-[10px] font-medium px-2 py-1 rounded-full border border-violet-300 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
                    >
                      {entity.name}
                      <span className="ml-1 opacity-60">{entity.type}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Answer markdown */}
              <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-200 [&_strong]:!text-inherit [&_p]:leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {data.answer ?? ''}
                </ReactMarkdown>
              </div>

              {/* Sources list */}
              {data.sources?.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-blue-500/20">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                    {t(
                      'chat.graphSourcesFound',
                      '{{count}} additional pages discovered',
                      { count: data.sources.length },
                    )}
                  </p>
                  <div className="space-y-1">
                    {data.sources.map((source, i) => (
                      <div
                        key={i}
                        className="text-[10px] text-slate-400 dark:text-slate-500 font-mono"
                      >
                        Page {source.segment_index + 1} &middot;{' '}
                        {source.match_type ?? 'graph'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Right (or full): Graph */}
          <div
            className={hasAnswer ? 'flex-1' : 'w-full h-full'}
            style={{ backgroundColor: GRAPH_BG }}
          >
            <GraphView data={graphData} />
          </div>
        </div>
      </div>
    </div>
  );
}
