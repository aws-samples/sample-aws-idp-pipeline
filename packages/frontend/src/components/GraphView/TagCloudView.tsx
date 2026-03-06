import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import cloud from 'd3-cloud';
import type { GraphData } from './useGraphData';
import { getEntityColor, GRAPH_BG } from './constants';

interface TagItem {
  text: string;
  weight: number;
  entityType: string;
  color: string;
}

interface PlacedWord {
  text: string;
  size: number;
  x: number;
  y: number;
  rotate: number;
  color: string;
  entityType: string;
  weight: number;
}

interface TagCloudViewProps {
  data: GraphData;
  hiddenTypes: Set<string>;
  onTagClick?: (label: string) => void;
  minConnections?: number;
  maxTags?: number;
  rotation?: boolean;
}

function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setDark(el.classList.contains('dark'));
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Unique filter ID per component instance to avoid SVG ID collisions. */
let filterIdCounter = 0;

export default function TagCloudView({
  data,
  hiddenTypes,
  onTagClick,
  minConnections = 1,
  maxTags = 100,
  rotation = true,
}: TagCloudViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [words, setWords] = useState<PlacedWord[]>([]);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const isDark = useIsDark();
  const [filterId] = useState(() => `tag-glow-${++filterIdCounter}`);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    setDimensions({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const tags = useMemo(() => {
    const entityEdgeCount = new Map<string, number>();
    const entityInfo = new Map<string, { label: string; entityType: string }>();

    for (const node of data.nodes) {
      if (node.type !== 'entity') continue;
      const entityType = (node.properties?.entity_type as string) ?? 'CONCEPT';
      if (hiddenTypes.has(entityType)) continue;
      entityInfo.set(node.id, { label: node.label, entityType });
      entityEdgeCount.set(node.id, 0);
    }

    for (const edge of data.edges) {
      if (entityEdgeCount.has(edge.source)) {
        entityEdgeCount.set(
          edge.source,
          (entityEdgeCount.get(edge.source) ?? 0) + 1,
        );
      }
      if (entityEdgeCount.has(edge.target)) {
        entityEdgeCount.set(
          edge.target,
          (entityEdgeCount.get(edge.target) ?? 0) + 1,
        );
      }
    }

    const items: TagItem[] = [];
    for (const [id, count] of entityEdgeCount) {
      const info = entityInfo.get(id);
      if (!info) continue;
      items.push({
        text: info.label,
        weight: count + 1,
        entityType: info.entityType,
        color: getEntityColor(info.entityType),
      });
    }

    const merged = new Map<string, TagItem>();
    for (const item of items) {
      const existing = merged.get(item.text);
      if (existing) {
        existing.weight += item.weight;
      } else {
        merged.set(item.text, { ...item });
      }
    }

    return Array.from(merged.values())
      .filter((t) => t.weight >= minConnections)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxTags);
  }, [data, hiddenTypes, minConnections, maxTags]);

  useEffect(() => {
    if (tags.length === 0 || dimensions.width === 0) {
      setWords([]);
      return;
    }

    const maxWeight = Math.max(...tags.map((t) => t.weight));
    const minWeight = Math.min(...tags.map((t) => t.weight));
    const range = maxWeight - minWeight || 1;

    const minFont = 14;
    const maxFont = Math.min(72, dimensions.width / 8);

    const layout = cloud()
      .size([dimensions.width, dimensions.height])
      .words(
        tags.map((t) => ({
          text: t.text,
          size:
            minFont + ((t.weight - minWeight) / range) * (maxFont - minFont),
          color: t.color,
          entityType: t.entityType,
          weight: t.weight,
        })),
      )
      .padding(4)
      .rotate(() => (rotation ? (Math.random() > 0.7 ? 90 : 0) : 0))
      .font('sans-serif')
      .fontSize((d) => (d as { size: number }).size)
      .on('end', (output: PlacedWord[]) => {
        setWords(output);
      });

    layout.start();
  }, [tags, dimensions, rotation]);

  const handleClick = useCallback(
    (text: string) => {
      onTagClick?.(text);
    },
    [onTagClick],
  );

  const tagsByLabel = useMemo(() => {
    const map = new Map<string, TagItem>();
    for (const t of tags) map.set(t.text, t);
    return map;
  }, [tags]);

  const hoveredInfo = useMemo(() => {
    if (!hoveredTag) return null;
    const tag = tagsByLabel.get(hoveredTag);
    const word = words.find((w) => w.text === hoveredTag);
    if (!tag || !word) return null;
    return {
      ...word,
      entityType: tag.entityType,
      weight: tag.weight,
      color: tag.color,
    };
  }, [hoveredTag, tagsByLabel, words]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({
      x: e.clientX - rect.left + 14,
      y: e.clientY - rect.top - 10,
    });
  }, []);

  if (tags.length === 0) {
    return (
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center text-slate-400"
        style={{ background: GRAPH_BG }}
      >
        No entities found
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ background: isDark ? GRAPH_BG : '#cbd5e1' }}
      onMouseMove={handleMouseMove}
    >
      <svg width={dimensions.width} height={dimensions.height}>
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g
          transform={`translate(${dimensions.width / 2},${dimensions.height / 2})`}
        >
          {words.map((w, i) => {
            const isHovered = hoveredTag === w.text;
            const dimmed = hoveredTag && !isHovered;
            return (
              <text
                key={`${w.text}-${i}`}
                textAnchor="middle"
                transform={`translate(${w.x},${w.y}) rotate(${w.rotate})`}
                filter={isHovered ? `url(#${filterId})` : undefined}
                style={{
                  fontSize: w.size,
                  fontFamily: 'sans-serif',
                  fontWeight: w.weight > 3 ? 600 : 400,
                  fill: isHovered ? lighten(w.color, 0.35) : w.color,
                  opacity: dimmed ? 0.15 : isHovered ? 1 : 0.8,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s, fill 0.2s',
                }}
                onClick={() => handleClick(w.text)}
                onMouseEnter={() => setHoveredTag(w.text)}
                onMouseLeave={() => setHoveredTag(null)}
              >
                {w.text}
              </text>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredInfo && (
        <div
          className="absolute z-20 pointer-events-none px-3 py-2 rounded-lg shadow-lg text-[11px] leading-relaxed border backdrop-blur-sm"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            background: isDark
              ? 'rgba(13, 17, 23, 0.92)'
              : 'rgba(255, 255, 255, 0.92)',
            borderColor: isDark
              ? 'rgba(59, 66, 100, 0.6)'
              : 'rgba(0, 0, 0, 0.1)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-[13px] text-slate-800 dark:text-slate-100">
              {hoveredInfo.text}
            </span>
          </div>
          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: hoveredInfo.color }}
              />
              {hoveredInfo.entityType}
            </span>
            <span>
              {hoveredInfo.weight} connection
              {hoveredInfo.weight !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function lighten(hex: string, amount = 0.4): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${lr},${lg},${lb})`;
}
