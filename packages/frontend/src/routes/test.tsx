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

interface Agent {
  name: string;
  content?: string;
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

  // Agent states
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentContent, setNewAgentContent] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

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

      {/* Agent API Test Section */}
      {selectedProject && (
        <section style={{ marginTop: '24px' }}>
          <h2>Agent Management</h2>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Project: <strong>{selectedProject.project_id}</strong>
          </p>

          {/* Create Agent Form */}
          <div
            style={{
              marginBottom: '16px',
              padding: '16px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              backgroundColor: '#f9f9f9',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Create New Agent</h3>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <input
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="Agent name"
                style={{
                  padding: '8px 12px',
                  fontSize: '14px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              />
              <textarea
                value={newAgentContent}
                onChange={(e) => setNewAgentContent(e.target.value)}
                placeholder="Agent system prompt (markdown)"
                rows={4}
                style={{
                  padding: '8px 12px',
                  fontSize: '14px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  fontFamily: 'monospace',
                }}
              />
              <button
                onClick={async () => {
                  if (!newAgentName.trim() || !newAgentContent.trim()) {
                    alert('Please fill in both name and content');
                    return;
                  }
                  try {
                    await fetchApi(
                      `projects/${selectedProject.project_id}/agents/${newAgentName}`,
                      {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          content: newAgentContent,
                        }),
                      },
                    );
                    setNewAgentName('');
                    setNewAgentContent('');
                    // Reload agents
                    setAgentsLoading(true);
                    const data = await fetchApi<Agent[]>(
                      `projects/${selectedProject.project_id}/agents`,
                    );
                    setAgents(data);
                    setAgentsLoading(false);
                  } catch (e) {
                    alert('Error: ' + (e as Error).message);
                  }
                }}
                disabled={!newAgentName.trim() || !newAgentContent.trim()}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor:
                    !newAgentName.trim() || !newAgentContent.trim()
                      ? '#ccc'
                      : '#28a745',
                  color: 'white',
                  cursor:
                    !newAgentName.trim() || !newAgentContent.trim()
                      ? 'not-allowed'
                      : 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                Create Agent
              </button>
            </div>
          </div>

          {/* Load Agents Button */}
          <button
            onClick={async () => {
              setAgentsLoading(true);
              setSelectedAgent(null);
              try {
                const data = await fetchApi<Agent[]>(
                  `projects/${selectedProject.project_id}/agents`,
                );
                setAgents(data);
              } catch (e) {
                alert('Error: ' + (e as Error).message);
              }
              setAgentsLoading(false);
            }}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#007bff',
              color: 'white',
              cursor: 'pointer',
              marginBottom: '16px',
            }}
          >
            {agentsLoading ? 'Loading...' : 'Load Agents'}
          </button>

          {/* Agents Table */}
          {agents.length > 0 && (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginBottom: '16px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#f0f0f0' }}>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Name
                  </th>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Updated At
                  </th>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.name}>
                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                      {agent.name}
                    </td>
                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                      {new Date(agent.updated_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                      <button
                        onClick={async () => {
                          try {
                            const data = await fetchApi<Agent>(
                              `projects/${selectedProject.project_id}/agents/${agent.name}`,
                            );
                            setSelectedAgent(data);
                          } catch (e) {
                            alert('Error: ' + (e as Error).message);
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '12px',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: '#17a2b8',
                          color: 'white',
                          cursor: 'pointer',
                          marginRight: '4px',
                        }}
                      >
                        View
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete agent "${agent.name}"?`))
                            return;
                          try {
                            await fetchApi(
                              `projects/${selectedProject.project_id}/agents/${agent.name}`,
                              {
                                method: 'DELETE',
                              },
                            );
                            setAgents(
                              agents.filter((a) => a.name !== agent.name),
                            );
                            if (selectedAgent?.name === agent.name) {
                              setSelectedAgent(null);
                            }
                          } catch (e) {
                            alert('Error: ' + (e as Error).message);
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '12px',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: '#dc3545',
                          color: 'white',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {agents.length === 0 && !agentsLoading && (
            <p style={{ color: '#666' }}>
              No agents found. Click "Load Agents" to fetch or create one above.
            </p>
          )}

          {/* Selected Agent Detail */}
          {selectedAgent && (
            <div
              style={{
                padding: '16px',
                border: '1px solid #17a2b8',
                borderRadius: '8px',
                backgroundColor: '#e7f6f8',
              }}
            >
              <h3 style={{ margin: '0 0 8px 0' }}>{selectedAgent.name}</h3>
              <pre
                style={{
                  backgroundColor: '#fff',
                  padding: '12px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                }}
              >
                {selectedAgent.content}
              </pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
