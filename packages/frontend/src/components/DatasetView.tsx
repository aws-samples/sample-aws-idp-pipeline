import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { useAwsClient } from '../hooks/useAwsClient';

export interface DatasetMeta {
  dataset_id: string;
  name: string;
  description: string;
  row_count: number | null;
  columns: string[] | null;
  source_document_id: string | null;
  reference_s3_uri: string | null;
}

interface QueryResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  offset: number;
  limit: number;
  has_more: boolean;
}

const PAGE_SIZE = 10;
const DEFAULT_QUERY = 'SELECT * FROM data';

interface DatasetViewProps {
  projectId: string;
  // Sheet list and selection are owned by the parent (WorkflowDetailModal) so the
  // sheet selector can live in the header bar. This component renders the SQL
  // workbench for the currently selected sheet.
  datasets: DatasetMeta[];
  selectedId: string | null;
  // True while the parent is still fetching the dataset list; show a spinner
  // rather than the "no dataset" empty state to avoid a flash.
  loadingList?: boolean;
}

/**
 * Dataset (structured data) SQL workbench: edit a read-only SQL query
 * (CodeMirror) against the selected sheet and page through results 10 rows at a
 * time. The backend wraps the query so even `SELECT * FROM data` is paginated.
 */
export default function DatasetView({
  projectId,
  datasets,
  selectedId,
  loadingList = false,
}: DatasetViewProps) {
  const { t } = useTranslation();
  const { fetchApi } = useAwsClient();
  const fetchApiRef = useRef(fetchApi);
  fetchApiRef.current = fetchApi;

  // The SQL currently being edited, and the SQL that produced the shown result.
  const [queryText, setQueryText] = useState(DEFAULT_QUERY);
  const [ranQuery, setRanQuery] = useState(DEFAULT_QUERY);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = datasets.find((d) => d.dataset_id === selectedId) ?? null;

  // Run a query (a specific page of it) against the selected dataset.
  const runPage = useCallback(
    (datasetId: string, query: string, pageOffset: number) => {
      setLoading(true);
      setError(null);
      fetchApiRef
        .current<QueryResponse>(
          `projects/${projectId}/datasets/${datasetId}/query`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              offset: pageOffset,
              limit: PAGE_SIZE,
            }),
          },
        )
        .then((res) => {
          setResult(res);
          setOffset(pageOffset);
          setRanQuery(query);
        })
        .catch((e: unknown) => {
          setResult(null);
          setError(
            e instanceof Error
              ? e.message
              : t('dataset.queryFailed', 'Query failed'),
          );
        })
        .finally(() => setLoading(false));
    },
    [projectId, t],
  );

  // On dataset change: reset to the default query, first page.
  useEffect(() => {
    if (!selectedId) return;
    setQueryText(DEFAULT_QUERY);
    runPage(selectedId, DEFAULT_QUERY, 0);
  }, [selectedId, runPage]);

  const runQuery = () => {
    if (!selectedId || !queryText.trim()) return;
    runPage(selectedId, queryText, 0);
  };

  const goPage = (nextOffset: number) => {
    if (!selectedId || nextOffset < 0 || loading) return;
    runPage(selectedId, ranQuery, nextOffset);
  };

  if (loadingList) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (datasets.length === 0) {
    return (
      <div className="w-full h-full p-6 text-center text-sm text-slate-400">
        {t('dataset.none', 'No structured dataset found for this document.')}
      </div>
    );
  }

  const totalRows = selected?.row_count ?? null;
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark');

  return (
    <div className="w-full h-full flex flex-col p-4 gap-3 min-h-0">
      {/* Meta */}
      {selected && (
        <div className="flex-shrink-0 text-[12px] text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {selected.name}
          </span>
          {totalRows != null && (
            <span className="ml-2">
              {t('dataset.totalRows', '{{count}} rows', { count: totalRows })}
            </span>
          )}
          {selected.columns && (
            <span className="ml-2">· {selected.columns.length} cols</span>
          )}
        </div>
      )}

      {/* SQL editor (read-only DuckDB SQL, table name: data) */}
      <div className="flex-shrink-0 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {t('dataset.sqlEditor', 'SQL (read-only, table name: data)')}
          </span>
          <span className="text-[10px] text-slate-400">
            {t('dataset.runHint', 'Cmd/Ctrl+Enter to run')}
          </span>
        </div>
        <div className="rounded-lg border border-black/10 dark:border-[#3b4264] overflow-hidden">
          <CodeMirror
            value={queryText}
            height="200px"
            theme={isDark ? 'dark' : 'light'}
            extensions={[sql()]}
            onChange={setQueryText}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                runQuery();
              }
            }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              autocompletion: true,
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runQuery}
            disabled={loading || !queryText.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {t('dataset.run', 'Run')}
          </button>
          <button
            onClick={() => {
              setQueryText(DEFAULT_QUERY);
              if (selectedId) runPage(selectedId, DEFAULT_QUERY, 0);
            }}
            disabled={loading}
            className="px-2 py-1.5 text-[12px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-50"
          >
            {t('dataset.reset', 'Reset')}
          </button>
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>
      </div>

      {/* Result grid */}
      <div className="flex-1 min-h-0 border border-black/[0.08] dark:border-[#2a2f45] rounded-lg overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : result && result.rows.length > 0 ? (
          <table className="min-w-full text-[12px] border-collapse">
            <thead className="bg-slate-100 dark:bg-white/[0.06] sticky top-0">
              <tr>
                {result.columns.map((col) => (
                  <th
                    key={col}
                    className="px-2.5 py-1.5 text-left font-semibold text-slate-600 dark:text-slate-300 border-b border-black/[0.08] dark:border-[#2a2f45] whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr
                  key={i}
                  className="odd:bg-black/[0.02] dark:odd:bg-white/[0.02]"
                >
                  {result.columns.map((col) => (
                    <td
                      key={col}
                      className="px-2.5 py-1 text-slate-600 dark:text-slate-300 border-b border-black/[0.04] dark:border-white/[0.04] whitespace-nowrap"
                    >
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-12 text-center text-sm text-slate-400">
            {t('dataset.noRows', 'No rows')}
          </div>
        )}
      </div>

      {/* Pagination */}
      {result && (result.rows.length > 0 || offset > 0) && (
        <div className="flex-shrink-0 flex items-center justify-between text-[12px] text-slate-500">
          <span>
            {result.rows.length > 0
              ? `${offset + 1}–${offset + result.rows.length}`
              : '0'}
            {result.has_more ? '+' : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goPage(offset - PAGE_SIZE)}
              disabled={offset === 0 || loading}
              className="p-1 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => goPage(offset + PAGE_SIZE)}
              disabled={loading || !result.has_more}
              className="p-1 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
