import { useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  /** When provided, entity type filter is controlled externally (no overlay). */
  hiddenTypes?: Set<string>;
  hiddenLinkTypes?: Set<string>;
  linkDirection?: LinkDirection;
  searchFilter?: string;
  depth?: number;
  focusPage?: number | null;
  showEdgeLabels?: boolean;
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
  hiddenTypes: controlledHiddenTypes,
  hiddenLinkTypes,
  linkDirection,
  searchFilter,
  depth,
  focusPage,
  showEdgeLabels,
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

  const ForceGraphView =
    viewMode === '3d' ? ForceGraphView3D : ForceGraphView2D;

  return (
    <div className="w-full h-full relative" style={{ background: GRAPH_BG }}>
      {/* View mode toggle */}
      <div className="absolute top-2 right-2 z-10 flex gap-0.5 bg-slate-800/80 backdrop-blur-sm rounded-lg shadow-md p-0.5">
        <button
          onClick={() => setViewMode('2d')}
          className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-all cursor-pointer ${
            viewMode === '2d'
              ? 'bg-slate-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          2D
        </button>
        <button
          onClick={() => setViewMode('3d')}
          className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-all cursor-pointer ${
            viewMode === '3d'
              ? 'bg-slate-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          3D
        </button>
      </div>
      {/* Show overlay filter only when uncontrolled */}
      {!isControlled && entityTypes.length > 0 && (
        <div className="absolute top-2 left-2 z-10 bg-slate-800/80 backdrop-blur-sm rounded-lg shadow-md p-2 flex flex-wrap gap-1.5 max-w-[300px]">
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
      />
    </div>
  );
}

export type { LinkDirection };
