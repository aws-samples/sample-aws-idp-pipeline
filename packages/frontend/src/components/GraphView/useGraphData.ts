import { useState, useEffect, useCallback, useRef } from 'react';

interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
  properties: Record<string, unknown> | null;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface UseGraphDataOptions {
  fetchApi: (path: string, options?: RequestInit) => Promise<Response>;
  projectId: string;
  documentId?: string;
}

export function useGraphData({
  fetchApi,
  projectId,
  documentId,
}: UseGraphDataOptions) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandingCluster, setExpandingCluster] = useState<string | null>(null);
  const baseDataRef = useRef<GraphData | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = documentId
        ? `projects/${projectId}/graph/documents/${documentId}`
        : `projects/${projectId}/graph`;
      const response = await fetchApi(path);
      if (!response.ok) {
        if (response.status === 404) {
          setData({ nodes: [], edges: [] });
          baseDataRef.current = null;
          return;
        }
        throw new Error(`Failed to fetch graph: ${response.status}`);
      }
      const result = await response.json();
      baseDataRef.current = result;
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph');
      setData(null);
      baseDataRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [fetchApi, projectId, documentId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const expandCluster = useCallback(
    async (entityType: string) => {
      if (!documentId || !data) return;
      setExpandingCluster(entityType);
      try {
        const path = `projects/${projectId}/graph/documents/${documentId}/expand/${encodeURIComponent(entityType)}`;
        const response = await fetchApi(path);
        if (!response.ok) {
          throw new Error(`Failed to expand cluster: ${response.status}`);
        }
        const result: GraphData = await response.json();

        // Remove cluster node and its edges, add individual entities
        const clusterId = `cluster_${entityType}`;
        const existingIds = new Set(data.nodes.map((n) => n.id));
        const newNodes = data.nodes.filter((n) => n.id !== clusterId);
        for (const node of result.nodes) {
          if (!existingIds.has(node.id)) {
            newNodes.push(node);
          }
        }

        const newEdges = data.edges.filter(
          (e) => e.source !== clusterId && e.target !== clusterId,
        );
        newEdges.push(...result.edges);

        setData({ nodes: newNodes, edges: newEdges });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to expand cluster');
      } finally {
        setExpandingCluster(null);
      }
    },
    [fetchApi, projectId, documentId, data],
  );

  const collapseCluster = useCallback(
    (entityType: string) => {
      if (!baseDataRef.current || !data) return;
      // Restore base data for this cluster type: remove expanded entities, restore cluster node
      const base = baseDataRef.current;
      const clusterNode = base.nodes.find(
        (n) => n.id === `cluster_${entityType}`,
      );
      if (!clusterNode) return;

      // Remove individual entities of this type
      const expandedEntityIds = new Set(
        data.nodes
          .filter(
            (n) =>
              n.type === 'entity' && n.properties?.entity_type === entityType,
          )
          .map((n) => n.id),
      );

      const newNodes = data.nodes.filter((n) => !expandedEntityIds.has(n.id));
      newNodes.push(clusterNode);

      const newEdges = data.edges.filter(
        (e) =>
          !expandedEntityIds.has(e.source as string) &&
          !expandedEntityIds.has(e.target as string),
      );
      // Restore cluster edges from base
      for (const edge of base.edges) {
        if (edge.source === clusterNode.id || edge.target === clusterNode.id) {
          newEdges.push(edge);
        }
      }

      setData({ nodes: newNodes, edges: newEdges });
    },
    [data],
  );

  return {
    data,
    loading,
    error,
    refetch: fetchGraph,
    expandCluster,
    collapseCluster,
    expandingCluster,
  };
}

export type { GraphNode, GraphEdge, GraphData };
