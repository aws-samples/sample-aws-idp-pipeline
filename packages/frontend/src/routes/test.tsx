import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAwsClient } from '../hooks/useAwsClient';

export const Route = createFileRoute('/test')({
  component: RouteComponent,
});

interface Project {
  project_id: string;
  name: string;
  description: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SearchResult {
  workflow_id: string;
  segment_id: string;
  segment_index: number;
  content: string;
  keywords: string;
  score: number;
}

interface RerankResult {
  workflow_id: string;
  segment_id: string;
  segment_index: number;
  content: string;
  keywords: string;
  rerank_score: number;
}

interface SearchResponse {
  results: SearchResult[];
}

interface RerankResponse {
  results: RerankResult[];
}

function RouteComponent() {
  const { fetchApi } = useAwsClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTime, setSearchTime] = useState<number | null>(null);
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(
    new Set(),
  );

  // Rerank search states
  const [rerankQuery, setRerankQuery] = useState('');
  const [rerankType, setRerankType] = useState<'bedrock' | 'local'>('bedrock');
  const [rerankResults, setRerankResults] = useState<RerankResult[]>([]);
  const [reranking, setReranking] = useState(false);
  const [rerankTime, setRerankTime] = useState<number | null>(null);
  const [expandedRerankSegments, setExpandedRerankSegments] = useState<
    Set<string>
  >(new Set());

  const toggleRerankSegment = (segmentId: string) => {
    setExpandedRerankSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  };

  const toggleSegment = (segmentId: string) => {
    setExpandedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  };

  useEffect(() => {
    const loadProjects = async () => {
      const data = await fetchApi<Project[]>('projects');
      setProjects(data);
      setLoading(false);
    };
    loadProjects();
  }, [fetchApi]);

  const handleSearch = async () => {
    if (!selectedProject || !query.trim()) return;
    setSearching(true);
    setSearchTime(null);
    const startTime = performance.now();
    const response = await fetchApi<SearchResponse>(
      `projects/${selectedProject.project_id}/search/hybrid?query=${encodeURIComponent(query)}`,
    );
    const endTime = performance.now();
    setSearchTime(endTime - startTime);
    setSearchResults(response.results);
    setSearching(false);
  };

  const handleRerankSearch = async () => {
    if (!selectedProject || !rerankQuery.trim()) return;
    setReranking(true);
    setRerankTime(null);
    const startTime = performance.now();
    const response = await fetchApi<RerankResponse>(
      `projects/${selectedProject.project_id}/search/rerank?query=${encodeURIComponent(rerankQuery)}&reranker_type=${rerankType}`,
    );
    const endTime = performance.now();
    setRerankTime(endTime - startTime);
    setRerankResults(response.results);
    setReranking(false);
  };

  if (loading) {
    return <div>Loading projects...</div>;
  }

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <h1>Test Page</h1>

      <section>
        <h2>Select Project</h2>
        <select
          value={selectedProject?.project_id ?? ''}
          onChange={(e) => {
            const project = projects.find(
              (p) => p.project_id === e.target.value,
            );
            setSelectedProject(project ?? null);
            setSearchResults([]);
            setRerankResults([]);
          }}
          style={{
            padding: '8px 12px',
            fontSize: '14px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            minWidth: '300px',
          }}
        >
          <option value="">-- Select a project --</option>
          {projects.map((project) => (
            <option key={project.project_id} value={project.project_id}>
              {project.name}
            </option>
          ))}
        </select>
      </section>

      {selectedProject && (
        <section style={{ marginTop: '24px' }}>
          <h2>Hybrid Search</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Enter search query..."
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                minWidth: '400px',
              }}
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor:
                  searching || !query.trim() ? '#ccc' : '#007bff',
                color: 'white',
                cursor: searching || !query.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div
                style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}
              >
                <h3 style={{ margin: 0 }}>Results ({searchResults.length})</h3>
                {searchTime !== null && (
                  <span style={{ fontSize: '14px', color: '#666' }}>
                    {searchTime < 1000
                      ? `${searchTime.toFixed(0)}ms`
                      : `${(searchTime / 1000).toFixed(2)}s`}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                {searchResults.map((result) => {
                  const isExpanded = expandedSegments.has(result.segment_id);
                  return (
                    <div
                      key={result.segment_id}
                      style={{
                        border: '1px solid #ddd',
                        borderRadius: '8px',
                        backgroundColor: '#fafafa',
                      }}
                    >
                      <div
                        onClick={() => toggleSegment(result.segment_id)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <span style={{ fontWeight: 'bold', color: '#333' }}>
                          {isExpanded ? '▼' : '▶'} Segment #
                          {result.segment_index}
                        </span>
                        <span style={{ color: '#666', fontSize: '12px' }}>
                          Score: {result.score.toFixed(4)}
                        </span>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 16px 16px' }}>
                          <div
                            style={{
                              fontSize: '14px',
                              lineHeight: '1.6',
                              color: '#444',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {result.content}
                          </div>
                          <div
                            style={{
                              marginTop: '8px',
                              fontSize: '12px',
                              color: '#888',
                            }}
                          >
                            Workflow: {result.workflow_id}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {selectedProject && (
        <section style={{ marginTop: '24px' }}>
          <h2>Rerank Search</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={rerankQuery}
              onChange={(e) => setRerankQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRerankSearch()}
              placeholder="Enter search query..."
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                minWidth: '400px',
              }}
            />
            <select
              value={rerankType}
              onChange={(e) =>
                setRerankType(e.target.value as 'bedrock' | 'local')
              }
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid #ccc',
              }}
            >
              <option value="bedrock">Bedrock</option>
              <option value="local">Local</option>
            </select>
            <button
              onClick={handleRerankSearch}
              disabled={reranking || !rerankQuery.trim()}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor:
                  reranking || !rerankQuery.trim() ? '#ccc' : '#007bff',
                color: 'white',
                cursor:
                  reranking || !rerankQuery.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {reranking ? 'Searching...' : 'Search'}
            </button>
          </div>

          {rerankResults.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div
                style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}
              >
                <h3 style={{ margin: 0 }}>Results ({rerankResults.length})</h3>
                {rerankTime !== null && (
                  <span style={{ fontSize: '14px', color: '#666' }}>
                    {rerankTime < 1000
                      ? `${rerankTime.toFixed(0)}ms`
                      : `${(rerankTime / 1000).toFixed(2)}s`}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                {rerankResults.map((result) => {
                  const isExpanded = expandedRerankSegments.has(
                    result.segment_id,
                  );
                  return (
                    <div
                      key={result.segment_id}
                      style={{
                        border: '1px solid #ddd',
                        borderRadius: '8px',
                        backgroundColor: '#fafafa',
                      }}
                    >
                      <div
                        onClick={() => toggleRerankSegment(result.segment_id)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <span style={{ fontWeight: 'bold', color: '#333' }}>
                          {isExpanded ? '▼' : '▶'} Segment #
                          {result.segment_index}
                        </span>
                        <span style={{ color: '#666', fontSize: '12px' }}>
                          Score: {result.rerank_score.toFixed(4)}
                        </span>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 16px 16px' }}>
                          <div
                            style={{
                              fontSize: '14px',
                              lineHeight: '1.6',
                              color: '#444',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {result.content}
                          </div>
                          <div
                            style={{
                              marginTop: '8px',
                              fontSize: '12px',
                              color: '#888',
                            }}
                          >
                            Workflow: {result.workflow_id}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
