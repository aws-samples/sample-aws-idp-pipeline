import { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ForceGraph3D from 'react-force-graph-3d';
import type { ForceGraphMethods as ForceGraphMethods3D } from 'react-force-graph-3d';
import * as THREE from 'three';
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
  z?: number;
}

interface ForceLink {
  source: string;
  target: string;
  edgeLabel: string;
  description?: string;
  color: string;
  properties?: Record<string, unknown> | null;
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
  onClusterClick?: (entityType: string) => void;
  onLinkClick?: (link: {
    source: string;
    target: string;
    label: string;
    properties?: Record<string, unknown> | null;
  }) => void;
}

const DEFAULT_LINK_COLOR = '#4b5563';

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

const labelTextureCache = new Map<string, THREE.CanvasTexture>();
const labelScaleCache = new Map<string, { x: number; y: number }>();

function getOrCreateLabelTexture(
  text: string,
  color: string,
): { texture: THREE.CanvasTexture; scaleX: number; scaleY: number } {
  const key = `${text}:${color}`;
  let texture = labelTextureCache.get(key);
  let scale = labelScaleCache.get(key);
  if (!texture || !scale) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx)
      return { texture: new THREE.CanvasTexture(canvas), scaleX: 1, scaleY: 1 };
    const fontSize = 48;
    ctx.font = `${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(text).width;
    canvas.width = textWidth + 20;
    canvas.height = fontSize + 16;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    texture = new THREE.CanvasTexture(canvas);
    scale = { x: canvas.width / 10, y: canvas.height / 10 };
    labelTextureCache.set(key, texture);
    labelScaleCache.set(key, scale);
  }
  return { texture, scaleX: scale.x, scaleY: scale.y };
}

function createSpriteLabel(text: string, color: string): THREE.Sprite {
  const { texture, scaleX, scaleY } = getOrCreateLabelTexture(text, color);
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(scaleX, scaleY, 1);
  return sprite;
}

const pageTextureCache = new Map<string, THREE.CanvasTexture>();

function getOrCreatePageTexture(
  baseColor: string,
  matched: boolean,
  dark: boolean,
): THREE.CanvasTexture {
  const key = `${baseColor}:${matched}:${dark}`;
  let texture = pageTextureCache.get(key);
  if (!texture) {
    texture = createPageTextureRaw(baseColor, matched, dark);
    pageTextureCache.set(key, texture);
  }
  return texture;
}

const materialCache = new Map<string, THREE.MeshLambertMaterial>();

function getOrCreateMaterial(
  color: string,
  opacity: number,
  emissive?: boolean,
): THREE.MeshLambertMaterial {
  const key = `${color}:${opacity}:${emissive ?? false}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      ...(emissive
        ? { emissive: new THREE.Color(color), emissiveIntensity: 1.0 }
        : {}),
    });
    materialCache.set(key, mat);
  }
  return mat;
}

function createGeometryCache() {
  return {
    sphere: new THREE.SphereGeometry(1, 16, 12),
    box: new THREE.BoxGeometry(1, 1, 1),
    plane: new THREE.PlaneGeometry(1, 1),
    octahedron: new THREE.OctahedronGeometry(1),
    cylinder: new THREE.CylinderGeometry(0.8, 1, 0.3, 6),
  };
}

let geometryCache = createGeometryCache();

function createPageTextureRaw(
  baseColor: string,
  matched: boolean,
  dark: boolean,
): THREE.CanvasTexture {
  const w = 128;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Parse base color
  const c = new THREE.Color(baseColor);
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);

  // Background - lighter shade
  const bgR = Math.min(255, r + Math.round((255 - r) * 0.6));
  const bgG = Math.min(255, g + Math.round((255 - g) * 0.6));
  const bgB = Math.min(255, b + Math.round((255 - b) * 0.6));

  const fold = w * 0.22;
  const cr = 6;

  // Page body with folded corner
  ctx.beginPath();
  ctx.moveTo(cr, 0);
  ctx.lineTo(w - fold, 0);
  ctx.lineTo(w, fold);
  ctx.lineTo(w, h - cr);
  ctx.quadraticCurveTo(w, h, w - cr, h);
  ctx.lineTo(cr, h);
  ctx.quadraticCurveTo(0, h, 0, h - cr);
  ctx.lineTo(0, cr);
  ctx.quadraticCurveTo(0, 0, cr, 0);
  ctx.closePath();
  ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
  ctx.fill();

  // Border
  ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
  ctx.lineWidth = matched ? 3 : 1.5;
  ctx.stroke();

  // Folded corner triangle
  ctx.beginPath();
  ctx.moveTo(w - fold, 0);
  ctx.lineTo(w - fold, fold);
  ctx.lineTo(w, fold);
  ctx.closePath();
  const foldR = Math.min(255, r + Math.round((255 - r) * 0.35));
  const foldG = Math.min(255, g + Math.round((255 - g) * 0.35));
  const foldB = Math.min(255, b + Math.round((255 - b) * 0.35));
  ctx.fillStyle = `rgb(${foldR},${foldG},${foldB})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Text lines
  const lineStartY = h * 0.3;
  const lineGap = h * 0.1;
  const lineAlpha = dark ? 0.25 : 0.2;
  ctx.fillStyle = `rgba(${r},${g},${b},${lineAlpha})`;
  for (let i = 0; i < 5; i++) {
    const lw = i === 4 ? w * 0.35 : i % 2 === 0 ? w * 0.65 : w * 0.55;
    ctx.fillRect(w * 0.12, lineStartY + i * lineGap, lw, h * 0.035);
  }

  // Matched glow border
  if (matched) {
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cr, 0);
    ctx.lineTo(w - fold, 0);
    ctx.lineTo(w, fold);
    ctx.lineTo(w, h - cr);
    ctx.quadraticCurveTo(w, h, w - cr, h);
    ctx.lineTo(cr, h);
    ctx.quadraticCurveTo(0, h, 0, h - cr);
    ctx.lineTo(0, cr);
    ctx.quadraticCurveTo(0, 0, cr, 0);
    ctx.closePath();
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
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
  onClusterClick,
  onLinkClick,
}: ForceGraphViewProps) {
  const { t } = useTranslation();
  const fgRef = useRef<ForceGraphMethods3D<ForceNode, ForceLink>>(undefined);
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
  const nodeObjectCache = useRef(new Map<string, THREE.Group>());

  // Cleanup Three.js renderer and cached objects on unmount
  useEffect(() => {
    const fg = fgRef.current;
    const cache = nodeObjectCache.current;
    return () => {
      if (fg) {
        const renderer = fg.renderer?.();
        if (renderer) {
          renderer.dispose();
        }
        const scene = fg.scene?.();
        if (scene) {
          scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry?.dispose();
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m) => m.dispose());
              } else if (obj.material) {
                obj.material.dispose();
              }
            } else if (obj instanceof THREE.Sprite) {
              obj.material?.map?.dispose();
              obj.material?.dispose();
            }
          });
          scene.clear();
        }
      }
      // Dispose cached node objects
      for (const group of cache.values()) {
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          } else if (child instanceof THREE.Sprite) {
            child.material?.map?.dispose();
            child.material?.dispose();
          }
        });
      }
      cache.clear();
      // Dispose module-level caches
      for (const t of labelTextureCache.values()) t.dispose();
      labelTextureCache.clear();
      labelScaleCache.clear();
      for (const t of pageTextureCache.values()) t.dispose();
      pageTextureCache.clear();
      for (const m of materialCache.values()) m.dispose();
      materialCache.clear();
      Object.values(geometryCache).forEach((g) => g.dispose());
      geometryCache = createGeometryCache();
    };
  }, []);

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
      if (node.type === 'entity' || node.type === 'cluster') {
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

    const seeds = new Set([...matchedIds, ...focusSegIds]);
    if (seeds.size > 0) {
      visibleIds = new Set(seeds);

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
      const isMatched =
        (hasActiveFilter && seeds.has(id)) || node.properties?.matched === true;
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
          radius: isMatched ? 16 : 13,
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
      } else if (node.type === 'cluster') {
        const entityType =
          (node.properties?.entity_type as string) ?? 'CONCEPT';
        const color = getEntityColor(entityType);
        const count = (node.properties?.count as number) ?? 0;
        nodes.push({
          id: node.id,
          label: node.label,
          nodeType: 'cluster',
          entityType,
          description: `${count} entities. Click to expand.`,
          matched: false,
          color,
          radius: Math.min(8 + Math.sqrt(count) * 1.5, 25),
        });
      }
    }

    // Step 4: build force links
    const links: ForceLink[] = [];
    for (const edge of data.edges) {
      if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target))
        continue;
      if (hiddenLinkTypes?.has(edge.label)) continue;

      if (linkDirection === 'outgoing') {
        if (query && !matchedIds.has(edge.source)) continue;
      } else if (linkDirection === 'incoming') {
        if (query && !matchedIds.has(edge.target)) continue;
      }

      links.push({
        source: edge.source,
        target: edge.target,
        edgeLabel: edge.label,
        description: (edge.properties?.context as string) || undefined,
        color: LINK_TYPE_COLORS[edge.label] ?? DEFAULT_LINK_COLOR,
        properties: edge.properties,
      });
    }

    // Remove orphan nodes
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

  // Zoom to fit after data changes
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    const delay =
      graphData.nodes.length > 500
        ? 500
        : graphData.nodes.length > 100
          ? 1500
          : 500;
    const timer = setTimeout(() => {
      const nodeCount = graphData.nodes.length;
      let padding = 0;
      if (nodeCount > 1000) padding = 50;
      else if (nodeCount > 500) padding = 20;
      else if (nodeCount > 200) padding = 0;
      else if (nodeCount > 50) padding = -10;
      fg.zoomToFit(400, padding);

      // Cinematic orbit after zoom settles
      const orbitTimer = setTimeout(() => {
        const cam = fg.camera?.();
        if (!cam) return;
        const dist = cam.position.length() || 300;
        const startAngle = Math.atan2(cam.position.x, cam.position.z);
        const y = cam.position.y;
        const duration = 2000;
        const totalAngle = Math.PI * 0.6;
        const t0 = performance.now();
        const animate = () => {
          const elapsed = performance.now() - t0;
          const progress = Math.min(elapsed / duration, 1);
          const ease = 1 - Math.pow(1 - progress, 3);
          const angle = startAngle + totalAngle * ease;
          fg.cameraPosition(
            {
              x: dist * Math.sin(angle),
              y: y * (1 - ease * 0.3),
              z: dist * Math.cos(angle),
            },
            { x: 0, y: 0, z: 0 },
          );
          if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }, 500);

      return () => clearTimeout(orbitTimer);
    }, delay);
    return () => clearTimeout(timer);
  }, [graphData]);

  const handleNodeClick = useCallback(
    (node: ForceNode) => {
      if (node.nodeType === 'cluster' && onClusterClick && node.entityType) {
        onClusterClick(node.entityType);
        return;
      }
      if (onNodeClick && node.id) {
        onNodeClick(node.id as string, node.nodeType);
      }
    },
    [onNodeClick, onClusterClick],
  );

  const handleLinkClick = useCallback(
    (link: ForceLink) => {
      if (!onLinkClick) return;
      const srcId =
        typeof link.source === 'object'
          ? (link.source as ForceNode).id
          : link.source;
      const tgtId =
        typeof link.target === 'object'
          ? (link.target as ForceNode).id
          : link.target;
      onLinkClick({
        source: srcId,
        target: tgtId,
        label: link.edgeLabel,
        properties: link.properties,
      });
    },
    [onLinkClick],
  );

  const handleNodeHover = useCallback((node: ForceNode | null) => {
    if (!node || (!node.description && !node.entityType)) {
      setHoveredNode(null);
      return;
    }
    const fg = fgRef.current;
    if (!fg) return;
    const coords = fg.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    setHoveredNode({ node, x: coords.x, y: coords.y });
  }, []);

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
    const mz = ((src.z ?? 0) + (tgt.z ?? 0)) / 2;
    const coords = fg.graph2ScreenCoords(mx, my, mz);
    setHoveredLink({
      label: link.edgeLabel,
      description: link.description,
      x: coords.x,
      y: coords.y,
    });
  }, []);

  // Dispose and clear node cache when graphData or isDark changes
  useEffect(() => {
    for (const group of nodeObjectCache.current.values()) {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        } else if (child instanceof THREE.Sprite) {
          child.material?.map?.dispose();
          child.material?.dispose();
        }
      });
    }
    nodeObjectCache.current.clear();
  }, [graphData, isDark]);

  // Create 3D node objects (cached per node id)
  const nodeThreeObject = useCallback(
    (node: ForceNode) => {
      const cacheKey = `${node.id}:${node.matched}:${isDark}`;
      const cached = nodeObjectCache.current.get(cacheKey);
      if (cached) return cached;

      const group = new THREE.Group();
      const r = node.radius * 0.15;
      let mesh: THREE.Mesh;
      const opacity = node.matched ? 1 : 0.85;

      if (node.nodeType === 'segment') {
        const geo = geometryCache.plane;
        const texture = getOrCreatePageTexture(
          node.color,
          !!node.matched,
          isDark,
        );
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(r * 3.5, r * 4.5, 1);
      } else if (node.nodeType === 'analysis') {
        mesh = new THREE.Mesh(
          geometryCache.octahedron,
          getOrCreateMaterial(node.color, opacity, !!node.matched),
        );
        mesh.scale.set(r, r * 1.2, r);
      } else if (node.nodeType === 'document') {
        mesh = new THREE.Mesh(
          geometryCache.cylinder,
          getOrCreateMaterial(node.color, opacity, !!node.matched),
        );
        mesh.scale.set(r * 1.8, r * 3, r * 1.8);
      } else if (node.nodeType === 'cluster') {
        // Large translucent sphere for cluster
        const clusterMat = new THREE.MeshLambertMaterial({
          color: new THREE.Color(node.color),
          transparent: true,
          opacity: 0.5,
          emissive: new THREE.Color(node.color),
          emissiveIntensity: 0.3,
        });
        mesh = new THREE.Mesh(geometryCache.sphere, clusterMat);
        mesh.scale.set(r, r, r);
        // Outer glow ring
        const ringMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(node.color),
          transparent: true,
          opacity: 0.15,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(geometryCache.sphere, ringMat);
        ring.scale.set(r * 1.5, r * 1.5, r * 1.5);
        group.add(ring);
      } else {
        mesh = new THREE.Mesh(
          geometryCache.sphere,
          getOrCreateMaterial(node.color, opacity, !!node.matched),
        );
        mesh.scale.set(r, r, r);
      }

      group.add(mesh);

      // Glow effect for matched (searched) nodes — pulsing
      if (node.matched) {
        // Inner glow
        const glowMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(node.color),
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        });
        const glow = new THREE.Mesh(geometryCache.sphere, glowMat);
        const glowScale = r * 3;
        glow.scale.set(glowScale, glowScale, glowScale);
        glow.name = 'matchGlow';
        glow.userData.baseScale = glowScale;
        group.add(glow);

        // Outer glow (softer, larger)
        const outerMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(node.color),
          transparent: true,
          opacity: 0.15,
          depthWrite: false,
        });
        const outer = new THREE.Mesh(geometryCache.sphere, outerMat);
        const outerScale = r * 5;
        outer.scale.set(outerScale, outerScale, outerScale);
        outer.name = 'matchGlow';
        outer.userData.baseScale = outerScale;
        group.add(outer);
      }

      const labelColor = isDark
        ? 'rgba(220, 225, 240, 0.9)'
        : 'rgba(15, 23, 42, 0.9)';
      const label = createSpriteLabel(node.label, labelColor);
      label.position.set(0, -(r + 1.5), 0);
      label.scale.multiplyScalar(0.4);
      group.add(label);

      nodeObjectCache.current.set(cacheKey, group);
      return group;
    },
    [isDark],
  );

  const handleEngineTick = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene?.();
    if (!scene) return;
    const t = Date.now() * 0.004;
    const pulse = 0.8 + 0.4 * Math.sin(t);
    const opPulse = 0.1 + 0.35 * Math.abs(Math.sin(t));
    scene.traverse((obj: THREE.Object3D) => {
      if (obj.name === 'matchGlow' && obj instanceof THREE.Mesh) {
        const base = obj.userData.baseScale ?? 1;
        const s = base * pulse;
        obj.scale.set(s, s, s);
        if (obj.material && 'opacity' in obj.material) {
          (obj.material as THREE.MeshBasicMaterial).opacity = opPulse;
        }
      }
    });
  }, []);

  const arrowLength = linkDirection !== 'incoming' ? 3 : 0;
  const particles = linkDirection !== 'incoming' ? 1 : 0;

  const hasFilter = !!(searchFilter?.trim() || focusPage != null);
  const isEmpty = graphData.nodes.length === 0 && hasFilter;

  const bgColor = isDark ? '#1e2235' : '#cbd5e1';
  // Fix forceEngine based on initial data size to avoid engine switch on search
  const initialLarge = useRef<boolean | null>(null);
  if (initialLarge.current === null && data.nodes.length > 0) {
    initialLarge.current = data.nodes.length > 500;
  }
  const isLargeGraph = initialLarge.current ?? false;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ backgroundColor: bgColor }}
    >
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-sm text-slate-400">
            {t('workflow.graph.noMatchingNodes')}
          </span>
        </div>
      )}
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor={bgColor}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={(link: ForceLink) => link.color}
        linkWidth={0.3}
        linkOpacity={0.6}
        linkDirectionalArrowLength={arrowLength}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={particles}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={0.005}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkClick={handleLinkClick}
        onLinkHover={handleLinkHover}
        onEngineTick={handleEngineTick}
        forceEngine={isLargeGraph ? 'ngraph' : 'd3'}
        cooldownTicks={graphData.nodes.length < 50 ? 30 : 100}
        enableNodeDrag
        enablePointerInteraction={
          !isLargeGraph || graphData.nodes.length < 5000
        }
      />
      {hoveredNode &&
        (hoveredNode.node.description || hoveredNode.node.entityType) && (
          <div
            className="absolute z-20 pointer-events-none max-w-[240px] px-2.5 py-1.5 rounded-md shadow-lg text-[11px] leading-relaxed bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600"
            style={{
              left: hoveredNode.x + 12,
              top: hoveredNode.y - 8,
            }}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-semibold text-[12px]">
                {hoveredNode.node.label}
              </span>
              {hoveredNode.node.entityType && (
                <span
                  className="text-[9px] font-medium px-1.5 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: hoveredNode.node.color }}
                >
                  {hoveredNode.node.entityType}
                </span>
              )}
            </div>
            {hoveredNode.node.description && hoveredNode.node.description}
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
