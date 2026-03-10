import { useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2 } from 'lucide-react';
import ForceGraphView2D from './ForceGraphView2D';
import ForceGraphView3D from './ForceGraphView3D';
import type { LinkDirection } from './ForceGraphView3D';
import type { GraphData } from './useGraphData';
import { getEntityColor, GRAPH_BG } from './constants';

type ViewMode = '2d' | '3d';

interface GraphViewProps {
  data: GraphData;
  onNodeClick?: (nodeId: string, nodeType: string) => void;
  onClusterClick?: (entityType: string) => void;
  onExpandAll?: () => void;
  expandingAll?: boolean;
  /** When provided, entity type filter is controlled externally (no overlay). */
  hiddenTypes?: Set<string>;
  hiddenLinkTypes?: Set<string>;
  linkDirection?: LinkDirection;
  searchFilter?: string;
  depth?: number;
  focusPage?: number | null;
  showEdgeLabels?: boolean;
  onLinkClick?: (link: {
    source: string;
    target: string;
    label: string;
    properties?: Record<string, unknown> | null;
  }) => void;
}

function collectEntityTypes(data: GraphData): string[] {
  const types = new Set<string>();
  for (const node of data.nodes) {
    if (node.type === 'entity') {
      types.add((node.properties?.entity_type as string) ?? 'CONCEPT');
    } else if (node.type === 'cluster') {
      types.add((node.properties?.entity_type as string) ?? 'CONCEPT');
    }
  }
  return Array.from(types).sort();
}

export default function GraphView({
  data,
  onNodeClick,
  onClusterClick,
  onExpandAll,
  expandingAll,
  hiddenTypes: controlledHiddenTypes,
  hiddenLinkTypes,
  linkDirection,
  searchFilter,
  depth,
  focusPage,
  showEdgeLabels,
  onLinkClick,
}: GraphViewProps) {
  const { t } = useTranslation();
  const [internalHiddenTypes, setInternalHiddenTypes] = useState<Set<string>>(
    new Set(),
  );
  const [viewMode, setViewMode] = useState<ViewMode>('3d');

  const isControlled = controlledHiddenTypes !== undefined;
  const hiddenTypes = isControlled
    ? controlledHiddenTypes
    : internalHiddenTypes;

  const entityTypes = useMemo(() => collectEntityTypes(data), [data]);

  const toggleType = useCallback((type: string) => {
    setInternalHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  if (data.nodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-full text-slate-400"
        style={{ background: GRAPH_BG }}
      >
        {t('workflow.graph.noData')}
      </div>
    );
  }

  const hasClusters = data.nodes.some((n) => n.type === 'cluster');

  const ForceGraphView =
    viewMode === '3d' ? ForceGraphView3D : ForceGraphView2D;

  return (
    <div className="w-full h-full relative" style={{ background: GRAPH_BG }}>
      {/* View mode toggle + expand all */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
        {hasClusters && onExpandAll && (
          <button
            onClick={onExpandAll}
            disabled={expandingAll}
            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg bg-white/90 dark:bg-slate-800/80 backdrop-blur-sm shadow-md border border-slate-200/60 dark:border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Maximize2 className="h-3 w-3" />
            {expandingAll
              ? t('workflow.graph.expanding', 'Expanding...')
              : t('workflow.graph.expandAll', 'Expand All')}
          </button>
        )}
        <div className="flex gap-0.5 bg-slate-200/90 dark:bg-slate-800/80 backdrop-blur-sm rounded-lg shadow-md p-0.5 border border-slate-300 dark:border-transparent">
          <button
            onClick={() => setViewMode('2d')}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              viewMode === '2d'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            2D
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              viewMode === '3d'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            3D
          </button>
        </div>
      </div>
      {/* Show overlay filter only when uncontrolled */}
      {!isControlled && entityTypes.length > 0 && (
        <div className="absolute top-2 left-2 z-10 bg-white/90 dark:bg-slate-800/80 backdrop-blur-sm rounded-lg shadow-md border border-slate-200/60 dark:border-transparent p-2 flex flex-wrap gap-1.5 max-w-[300px]">
          {entityTypes.map((type) => {
            const color = getEntityColor(type);
            const active = !hiddenTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className="text-[10px] font-medium px-2 py-1 rounded-full border transition-all cursor-pointer"
                style={{
                  borderColor: color,
                  backgroundColor: active ? color : 'transparent',
                  color: active ? '#fff' : color,
                  opacity: active ? 1 : 0.5,
                }}
              >
                {type}
              </button>
            );
          })}
        </div>
      )}
      <ForceGraphView
        data={data}
        hiddenTypes={hiddenTypes}
        hiddenLinkTypes={hiddenLinkTypes}
        linkDirection={linkDirection}
        searchFilter={searchFilter}
        depth={depth}
        focusPage={focusPage}
        showEdgeLabels={showEdgeLabels}
        onNodeClick={onNodeClick}
        onClusterClick={onClusterClick}
        onLinkClick={onLinkClick}
      />
    </div>
  );
}

export type { LinkDirection };
