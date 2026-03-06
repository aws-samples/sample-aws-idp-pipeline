import { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import { forceX, forceY } from 'd3-force';
import type { GraphData } from './useGraphData';
import {
  getEntityColor,
  SEGMENT_COLOR,
  ANALYSIS_COLOR,
  DOCUMENT_COLOR,
  LINK_TYPE_COLORS,
} from './constants';

interface ForceNode {
  id: string;
  label: string;
  nodeType: string;
  entityType?: string;
  description?: string;
  matched?: boolean;
  color: string;
  radius: number;
  x?: number;
  y?: number;
}

interface ForceLink {
  source: string;
  target: string;
  edgeLabel: string;
  description?: string;
  color: string;
}

export type LinkDirection = 'both' | 'outgoing' | 'incoming';

export interface ForceGraphViewProps {
  data: GraphData;
  hiddenTypes: Set<string>;
  hiddenLinkTypes?: Set<string>;
  linkDirection?: LinkDirection;
  searchFilter?: string;
  depth?: number;
  focusPage?: number | null;
  showEdgeLabels?: boolean;
  onNodeClick?: (nodeId: string, nodeType: string) => void;
}

const DEFAULT_LINK_COLOR = '#4b5563';

const THEME = {
  light: {
    bg: '#cbd5e1', // slate-300
    labelColor: (a: number) => `rgba(15, 23, 42, ${a})`, // slate-900
    glowBlur: 8,
  },
  dark: {
    bg: '#1e2235',
    labelColor: (a: number) => `rgba(220, 225, 240, ${a})`,
    glowBlur: 15,
  },
} as const;

function lighten(hex: string, amount = 0.4): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${lr},${lg},${lb})`;
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
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export default function ForceGraphView({
  data,
  hiddenTypes,
  hiddenLinkTypes,
  linkDirection = 'both',
  searchFilter,
  depth = 3,
  focusPage,
  showEdgeLabels = true,
  onNodeClick,
}: ForceGraphViewProps) {
  const { t } = useTranslation();
  const fgRef = useRef<ForceGraphMethods<ForceNode, ForceLink>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<{
    node: ForceNode;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredLink, setHoveredLink] = useState<{
    label: string;
    description: string;
    x: number;
    y: number;
  } | null>(null);
  const isDark = useIsDark();
  const theme = isDark ? THEME.dark : THEME.light;

  // Observe container size
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

  // Build adjacency helpers for direction-aware edge traversal
  const { outgoing, incoming } = useMemo(() => {
    const out = new Map<string, { target: string; label: string }[]>();
    const inc = new Map<string, { source: string; label: string }[]>();
    for (const edge of data.edges) {
      const outList = out.get(edge.source) ?? [];
      outList.push({ target: edge.target, label: edge.label });
      out.set(edge.source, outList);
      const incList = inc.get(edge.target) ?? [];
      incList.push({ source: edge.source, label: edge.label });
      inc.set(edge.target, incList);
    }
    return { outgoing: out, incoming: inc };
  }, [data.edges]);

  // Convert GraphData -> force graph data
  const graphData = useMemo(() => {
    const query = searchFilter?.trim().toLowerCase() ?? '';

    // Step 1: determine which node IDs pass type + page range filter
    const typePassIds = new Set<string>();
    for (const node of data.nodes) {
      if (node.type === 'entity') {
        const entityType =
          (node.properties?.entity_type as string) ?? 'CONCEPT';
        if (hiddenTypes.has(entityType)) continue;
      }
      if (
        (node.type === 'segment' || node.type === 'analysis') &&
        focusPage != null
      ) {
        const idx = node.properties?.segment_index as number | undefined;
        if (idx != null && idx !== focusPage) continue;
      }
      typePassIds.add(node.id);
    }

    // Step 2: determine seed nodes and expand neighbors
    let visibleIds: Set<string>;
    const matchedIds = new Set<string>();

    // Collect seed nodes: search matches and/or focused page segments
    const focusSegIds = new Set<string>();
    if (focusPage != null) {
      for (const node of data.nodes) {
        if (
          node.type === 'segment' &&
          typePassIds.has(node.id) &&
          (node.properties?.segment_index as number) === focusPage
        ) {
          focusSegIds.add(node.id);
        }
      }
    }

    if (query) {
      for (const node of data.nodes) {
        if (!typePassIds.has(node.id)) continue;
        const desc = (
          (node.properties?.description as string) ?? ''
        ).toLowerCase();
        if (node.label.toLowerCase().includes(query) || desc.includes(query)) {
          matchedIds.add(node.id);
        }
      }
    }

    // If we have seeds (search or focus page), expand from them
    const seeds = new Set([...matchedIds, ...focusSegIds]);
    if (seeds.size > 0) {
      visibleIds = new Set(seeds);

      // Expand neighbors up to `depth` hops
      let frontier = new Set(seeds);
      for (let d = 0; d < depth; d++) {
        const nextFrontier = new Set<string>();
        for (const id of frontier) {
          if (linkDirection === 'both' || linkDirection === 'outgoing') {
            for (const e of outgoing.get(id) ?? []) {
              if (hiddenLinkTypes?.has(e.label)) continue;
              if (!visibleIds.has(e.target) && typePassIds.has(e.target)) {
                visibleIds.add(e.target);
                nextFrontier.add(e.target);
              }
            }
          }
          if (linkDirection === 'both' || linkDirection === 'incoming') {
            for (const e of incoming.get(id) ?? []) {
              if (hiddenLinkTypes?.has(e.label)) continue;
              if (!visibleIds.has(e.source) && typePassIds.has(e.source)) {
                visibleIds.add(e.source);
                nextFrontier.add(e.source);
              }
            }
          }
        }
        frontier = nextFrontier;
        if (frontier.size === 0) break;
      }
    } else if (query) {
      // Search active but nothing matched — show empty result
      visibleIds = new Set();
    } else {
      visibleIds = typePassIds;
    }

    // Step 3: build force nodes
    const hasActiveFilter = seeds.size > 0;
    const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
    const nodes: ForceNode[] = [];
    for (const id of visibleIds) {
      const node = nodeMap.get(id);
      if (!node) continue;
      const isMatched = hasActiveFilter && seeds.has(id);
      if (node.type === 'entity') {
        const entityType =
          (node.properties?.entity_type as string) ?? 'CONCEPT';
        const color = getEntityColor(entityType);
        nodes.push({
          id: node.id,
          label: node.label,
          nodeType: 'entity',
          entityType,
          description: (node.properties?.description as string) || undefined,
          matched: isMatched,
          color,
          radius: isMatched ? 11 : 8,
        });
      } else if (node.type === 'segment') {
        const segIdx = node.properties?.segment_index as number | undefined;
        const segLabel = segIdx != null ? `Page ${segIdx + 1}` : node.label;
        nodes.push({
          id: node.id,
          label: segLabel,
          nodeType: 'segment',
          matched: isMatched,
          color: SEGMENT_COLOR,
          radius: isMatched ? 12 : 9,
        });
      } else if (node.type === 'analysis') {
        const qaIdx = node.properties?.qa_index as number | undefined;
        const qaLabel = qaIdx != null ? `QA ${qaIdx + 1}` : node.label;
        nodes.push({
          id: node.id,
          label: qaLabel,
          nodeType: 'analysis',
          description: (node.properties?.question as string) || undefined,
          matched: isMatched,
          color: ANALYSIS_COLOR,
          radius: isMatched ? 10 : 7,
        });
      } else if (node.type === 'document') {
        nodes.push({
          id: node.id,
          label: node.label,
          nodeType: 'document',
          matched: isMatched,
          color: DOCUMENT_COLOR,
          radius: isMatched ? 13 : 10,
        });
      }
    }

    // Step 4: build force links
    // linkDirection always filters edges:
    //   outgoing = only show source→target (forward arrows)
    //   incoming = only show target→source (reverse, stored as source→target but skip)
    // When search is active, direction is relative to matched nodes.
    // When no search, we use the adjacency list to decide per-node direction.
    const links: ForceLink[] = [];
    for (const edge of data.edges) {
      if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target))
        continue;
      if (hiddenLinkTypes?.has(edge.label)) continue;

      if (linkDirection === 'outgoing') {
        // Only keep edges going OUT from matched nodes (search) or all forward edges (no search)
        if (query && !matchedIds.has(edge.source)) continue;
      } else if (linkDirection === 'incoming') {
        // Only keep edges coming IN to matched nodes (search) or all reverse edges (no search)
        if (query && !matchedIds.has(edge.target)) continue;
      }

      links.push({
        source: edge.source,
        target: edge.target,
        edgeLabel: edge.label,
        description: (edge.properties?.context as string) || undefined,
        color: LINK_TYPE_COLORS[edge.label] ?? DEFAULT_LINK_COLOR,
      });
    }

    // Remove orphan nodes (no links)
    const connectedIds = new Set<string>();
    for (const link of links) {
      connectedIds.add(link.source as string);
      connectedIds.add(link.target as string);
    }
    const connectedNodes = nodes.filter((n) => connectedIds.has(n.id));

    return { nodes: connectedNodes, links };
  }, [
    data,
    hiddenTypes,
    hiddenLinkTypes,
    searchFilter,
    linkDirection,
    depth,
    focusPage,
    outgoing,
    incoming,
  ]);

  // Configure forces
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const nodeCount = graphData.nodes.length;
    const chargeStrength = nodeCount > 200 ? -80 : nodeCount > 50 ? -150 : -250;
    const linkDist = nodeCount > 200 ? 40 : nodeCount > 50 ? 60 : 80;

    const charge = fg.d3Force('charge');
    if (charge && typeof charge.strength === 'function') {
      charge.strength(chargeStrength);
      if (typeof charge.distanceMax === 'function') {
        charge.distanceMax(nodeCount > 100 ? 400 : 800);
      }
    }

    const link = fg.d3Force('link');
    if (link && typeof link.distance === 'function') {
      link.distance(linkDist);
    }

    // Gentle gravity to keep disconnected clusters from drifting too far
    if (nodeCount > 30) {
      const strength = nodeCount > 200 ? 0.05 : 0.03;
      fg.d3Force('gravityX', forceX(0).strength(strength));
      fg.d3Force('gravityY', forceY(0).strength(strength));
    } else {
      fg.d3Force('gravityX', null);
      fg.d3Force('gravityY', null);
    }
  }, [graphData]);

  // Zoom to fit after data changes
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    const delay = graphData.nodes.length > 100 ? 1500 : 500;
    const timer = setTimeout(() => {
      fg.zoomToFit(400, 40);
    }, delay);
    return () => clearTimeout(timer);
  }, [graphData]);

  const handleNodeClick = useCallback(
    (node: ForceNode) => {
      if (onNodeClick && node.id) {
        onNodeClick(node.id as string, node.nodeType);
      }
    },
    [onNodeClick],
  );

  const handleNodeHover = useCallback(
    (node: ForceNode | null, prevNode?: ForceNode | null) => {
      if (prevNode) setHoveredNode(null);
      if (!node || !node.description) return;
      const fg = fgRef.current;
      if (!fg) return;
      const coords = fg.graph2ScreenCoords(node.x ?? 0, node.y ?? 0);
      setHoveredNode({ node, x: coords.x, y: coords.y });
    },
    [],
  );

  const handleLinkHover = useCallback((link: ForceLink | null) => {
    if (!link || !link.description) {
      setHoveredLink(null);
      return;
    }
    const fg = fgRef.current;
    if (!fg) return;
    const src = link.source as unknown as ForceNode;
    const tgt = link.target as unknown as ForceNode;
    if (src.x == null || tgt.x == null) return;
    const mx = ((src.x ?? 0) + (tgt.x ?? 0)) / 2;
    const my = ((src.y ?? 0) + (tgt.y ?? 0)) / 2;
    const coords = fg.graph2ScreenCoords(mx, my);
    setHoveredLink({
      label: link.edgeLabel,
      description: link.description,
      x: coords.x,
      y: coords.y,
    });
  }, []);

  const nodeCanvasObject = useCallback(
    (node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = node.radius;
      const dark = document.documentElement.classList.contains('dark');
      const t = dark ? THEME.dark : THEME.light;
      const isMatch = node.matched;
      const nt = node.nodeType;

      if (nt === 'segment') {
        // Page: document icon with folded corner
        const w = r * 2;
        const h = r * 2.2;
        const fold = r * 0.55;
        const cx = x - w / 2;
        const cy = y - h / 2;
        const cr = r * 0.2;

        const pagePath = () => {
          ctx.beginPath();
          ctx.moveTo(cx + cr, cy);
          ctx.lineTo(cx + w - fold, cy);
          ctx.lineTo(cx + w, cy + fold);
          ctx.lineTo(cx + w, cy + h - cr);
          ctx.quadraticCurveTo(cx + w, cy + h, cx + w - cr, cy + h);
          ctx.lineTo(cx + cr, cy + h);
          ctx.quadraticCurveTo(cx, cy + h, cx, cy + h - cr);
          ctx.lineTo(cx, cy + cr);
          ctx.quadraticCurveTo(cx, cy, cx + cr, cy);
          ctx.closePath();
        };

        // Glow
        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isMatch ? t.glowBlur * 2.5 : t.glowBlur;
        pagePath();
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.restore();

        // Border
        pagePath();
        ctx.strokeStyle = lighten(node.color, 0.5);
        ctx.lineWidth = isMatch ? 1.5 : 0.8;
        ctx.stroke();

        // Folded corner triangle
        ctx.beginPath();
        ctx.moveTo(cx + w - fold, cy);
        ctx.lineTo(cx + w - fold, cy + fold);
        ctx.lineTo(cx + w, cy + fold);
        ctx.closePath();
        ctx.fillStyle = lighten(node.color, dark ? 0.25 : 0.45);
        ctx.fill();
        ctx.strokeStyle = lighten(node.color, 0.5);
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Text lines inside
        ctx.save();
        ctx.globalAlpha = dark ? 0.35 : 0.25;
        const lineY0 = cy + h * 0.35;
        const lineGap = h * 0.14;
        for (let i = 0; i < 3; i++) {
          const lw = i === 2 ? w * 0.45 : w * 0.65;
          ctx.fillStyle = lighten(node.color, 0.7);
          ctx.fillRect(cx + w * 0.15, lineY0 + i * lineGap, lw, h * 0.06);
        }
        ctx.restore();

        // Match ring
        if (isMatch) {
          ctx.save();
          ctx.shadowColor = node.color;
          ctx.shadowBlur = t.glowBlur * 3;
          pagePath();
          ctx.strokeStyle = lighten(node.color, 0.3);
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        }
      } else if (nt === 'analysis') {
        // QA: beveled diamond with inner gem facets
        const d = r * 1.4;

        const diamondPath = () => {
          ctx.beginPath();
          ctx.moveTo(x, y - d);
          ctx.lineTo(x + d, y);
          ctx.lineTo(x, y + d);
          ctx.lineTo(x - d, y);
          ctx.closePath();
        };

        // Glow
        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isMatch ? t.glowBlur * 2.5 : t.glowBlur;
        diamondPath();
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.restore();

        // Inner facets (top half lighter, bottom half darker)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x - d, y);
        ctx.closePath();
        ctx.fillStyle = lighten(node.color, isMatch ? 0.45 : 0.3);
        ctx.fill();
        ctx.restore();

        // Center horizontal line
        ctx.beginPath();
        ctx.moveTo(x - d * 0.5, y);
        ctx.lineTo(x + d * 0.5, y);
        ctx.strokeStyle = lighten(node.color, 0.5);
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Inner diamond
        const id = d * 0.45;
        ctx.beginPath();
        ctx.moveTo(x, y - id);
        ctx.lineTo(x + id, y);
        ctx.lineTo(x, y + id);
        ctx.lineTo(x - id, y);
        ctx.closePath();
        ctx.fillStyle = lighten(node.color, isMatch ? 0.6 : 0.4);
        ctx.fill();

        // Outer border
        diamondPath();
        ctx.strokeStyle = lighten(node.color, 0.5);
        ctx.lineWidth = isMatch ? 1.5 : 0.8;
        ctx.stroke();

        // Match ring
        if (isMatch) {
          ctx.save();
          ctx.shadowColor = node.color;
          ctx.shadowBlur = t.glowBlur * 3;
          diamondPath();
          ctx.strokeStyle = lighten(node.color, 0.3);
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        }
      } else if (nt === 'document') {
        // Document: folder tab shape
        const w = r * 2.6;
        const h = r * 2;
        const tabW = w * 0.4;
        const tabH = h * 0.18;
        const cr = r * 0.15;
        const cx = x - w / 2;
        const cy = y - h / 2;

        const folderPath = () => {
          ctx.beginPath();
          // Bottom-left corner
          ctx.moveTo(cx + cr, cy + tabH + h);
          // Bottom edge
          ctx.lineTo(cx + w - cr, cy + tabH + h);
          ctx.quadraticCurveTo(
            cx + w,
            cy + tabH + h,
            cx + w,
            cy + tabH + h - cr,
          );
          // Right edge
          ctx.lineTo(cx + w, cy + tabH + cr);
          ctx.quadraticCurveTo(cx + w, cy + tabH, cx + w - cr, cy + tabH);
          // Top-right of body to tab junction
          ctx.lineTo(cx + tabW + tabH * 0.5, cy + tabH);
          // Tab slant
          ctx.lineTo(cx + tabW, cy);
          // Tab top
          ctx.lineTo(cx + cr, cy);
          ctx.quadraticCurveTo(cx, cy, cx, cy + cr);
          // Left edge
          ctx.lineTo(cx, cy + tabH + h - cr);
          ctx.quadraticCurveTo(cx, cy + tabH + h, cx + cr, cy + tabH + h);
          ctx.closePath();
        };

        // Glow
        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isMatch ? t.glowBlur * 2.5 : t.glowBlur;
        folderPath();
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.restore();

        // Inner lighter fill
        folderPath();
        ctx.fillStyle = lighten(node.color, isMatch ? 0.45 : 0.3);
        ctx.fill();

        // Body area (below tab) slightly different shade
        ctx.beginPath();
        ctx.moveTo(cx + cr, cy + tabH + h);
        ctx.lineTo(cx + w - cr, cy + tabH + h);
        ctx.quadraticCurveTo(cx + w, cy + tabH + h, cx + w, cy + tabH + h - cr);
        ctx.lineTo(cx + w, cy + tabH);
        ctx.lineTo(cx, cy + tabH);
        ctx.lineTo(cx, cy + tabH + h - cr);
        ctx.quadraticCurveTo(cx, cy + tabH + h, cx + cr, cy + tabH + h);
        ctx.closePath();
        ctx.fillStyle = lighten(node.color, isMatch ? 0.55 : 0.4);
        ctx.fill();

        // Border
        folderPath();
        ctx.strokeStyle = lighten(node.color, 0.6);
        ctx.lineWidth = isMatch ? 1.5 : 0.8;
        ctx.stroke();

        // Match ring
        if (isMatch) {
          ctx.save();
          ctx.shadowColor = node.color;
          ctx.shadowBlur = t.glowBlur * 3;
          folderPath();
          ctx.strokeStyle = lighten(node.color, 0.3);
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        }
      } else {
        // Entity: circle
        if (isMatch) {
          ctx.save();
          ctx.shadowColor = node.color;
          ctx.shadowBlur = t.glowBlur * 3;
          ctx.beginPath();
          ctx.arc(x, y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = lighten(node.color, 0.3);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isMatch ? t.glowBlur * 2 : t.glowBlur;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = lighten(node.color, isMatch ? 0.7 : 0.5);
        ctx.fill();
      }

      // Label
      const fontSize = Math.max(10 / globalScale, 2);
      const labelAlpha = isMatch
        ? 1
        : Math.min(1, Math.max(0, (globalScale - 0.4) / 0.8));
      if (labelAlpha > 0.05) {
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = t.labelColor(labelAlpha);
        const labelY =
          nt === 'segment'
            ? y + r * 1.2
            : nt === 'document'
              ? y + r * 1.3
              : y + r + 2;
        ctx.fillText(node.label, x, labelY);
      }
    },
    [],
  );

  const nodePointerAreaPaint = useCallback(
    (node: ForceNode, color: string, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = node.radius + 2;
      ctx.beginPath();
      if (node.nodeType === 'segment') {
        const s = r * 1.6;
        ctx.rect(x - s / 2, y - s / 2, s, s);
      } else if (node.nodeType === 'analysis') {
        const d = r * 1.3;
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x, y + d);
        ctx.lineTo(x - d, y);
        ctx.closePath();
      } else if (node.nodeType === 'document') {
        const w = r * 2.8;
        const h = r * 2.4;
        ctx.rect(x - w / 2, y - h / 2, w, h);
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  const linkCanvasObject = useCallback(
    (link: ForceLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (!showEdgeLabels) return;

      const src = link.source as unknown as ForceNode;
      const tgt = link.target as unknown as ForceNode;
      if (!src.x || !tgt.x) return;

      const label = link.edgeLabel;
      if (!label) return;

      const fontSize = Math.max(8 / globalScale, 1.5);
      const labelAlpha = Math.min(1, Math.max(0, (globalScale - 0.6) / 1.0));
      if (labelAlpha < 0.05) return;

      const mx = (src.x + tgt.x) / 2;
      const my = ((src.y ?? 0) + (tgt.y ?? 0)) / 2;

      ctx.save();
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDark
        ? `rgba(180, 190, 210, ${labelAlpha})`
        : `rgba(60, 70, 90, ${labelAlpha})`;
      ctx.fillText(label, mx, my);
      ctx.restore();
    },
    [isDark, showEdgeLabels],
  );

  // Always show arrows; direction is already filtered in link building
  const arrowLength = linkDirection !== 'incoming' ? 4 : 0;
  const particles = linkDirection !== 'incoming' ? 1 : 0;

  const hasFilter = !!(searchFilter?.trim() || focusPage != null);
  const isEmpty = graphData.nodes.length === 0 && hasFilter;

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-slate-300 dark:bg-[#1e2235] relative"
    >
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-sm text-slate-400">
            {t('workflow.graph.noMatchingNodes')}
          </span>
        </div>
      )}
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor={theme.bg}
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={nodePointerAreaPaint}
        linkCanvasObjectMode={() => 'after'}
        linkCanvasObject={linkCanvasObject}
        linkColor={(link: ForceLink) => link.color}
        linkWidth={1}
        linkDirectionalArrowLength={arrowLength}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={particles}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleSpeed={0.005}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkHover={handleLinkHover}
        minZoom={0.3}
        maxZoom={8}
        cooldownTicks={100}
        enableNodeDrag
      />
      {hoveredNode && hoveredNode.node.description && (
        <div
          className="absolute z-20 pointer-events-none max-w-[240px] px-2.5 py-1.5 rounded-md shadow-lg text-[11px] leading-relaxed bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600"
          style={{
            left: hoveredNode.x + 12,
            top: hoveredNode.y - 8,
          }}
        >
          <div className="font-semibold text-[12px] mb-0.5">
            {hoveredNode.node.label}
          </div>
          {hoveredNode.node.description}
        </div>
      )}
      {hoveredLink && (
        <div
          className="absolute z-20 pointer-events-none max-w-[240px] px-2.5 py-1.5 rounded-md shadow-lg text-[11px] leading-relaxed bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600"
          style={{
            left: hoveredLink.x + 12,
            top: hoveredLink.y - 8,
          }}
        >
          <div className="font-semibold text-[12px] mb-0.5">
            {hoveredLink.label}
          </div>
          {hoveredLink.description}
        </div>
      )}
    </div>
  );
}
