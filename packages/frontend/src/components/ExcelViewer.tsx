import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Loader2 } from 'lucide-react';

interface ExcelViewerProps {
  url: string;
  sheetIndex?: number;
  className?: string;
}

interface MergeInfo {
  rowSpan?: number;
  colSpan?: number;
  hidden?: boolean;
}

export default function ExcelViewer({
  url,
  sheetIndex = 0,
  className = '',
}: ExcelViewerProps) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!url) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (controller.signal.aborted) return;
        const wb = XLSX.read(buf, { type: 'array' });
        setWorkbook(wb);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load Excel file:', err);
        setError('Failed to load Excel file');
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [url]);

  const buildMergeMap = useCallback(
    (sheet: XLSX.WorkSheet): Map<string, MergeInfo> => {
      const map = new Map<string, MergeInfo>();
      const merges = sheet['!merges'];
      if (!merges) return map;

      for (const range of merges) {
        const { s, e } = range;
        const rowSpan = e.r - s.r + 1;
        const colSpan = e.c - s.c + 1;

        map.set(`${s.r}:${s.c}`, { rowSpan, colSpan });

        for (let r = s.r; r <= e.r; r++) {
          for (let c = s.c; c <= e.c; c++) {
            if (r === s.r && c === s.c) continue;
            map.set(`${r}:${c}`, { hidden: true });
          }
        }
      }
      return map;
    },
    [],
  );

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading Excel...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  if (!workbook) return null;

  const sheetNames = workbook.SheetNames;
  const clampedIndex = Math.min(sheetIndex, sheetNames.length - 1);
  const sheetName = sheetNames[clampedIndex];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
    sheet,
    { header: 1, defval: '' },
  );
  const mergeMap = buildMergeMap(sheet);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Sheet name label */}
      <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200">
        <span className="text-xs font-medium text-slate-500">{sheetName}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm">
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {(row as (string | number | boolean | null)[]).map(
                  (cell, colIdx) => {
                    const key = `${rowIdx}:${colIdx}`;
                    const merge = mergeMap.get(key);

                    if (merge?.hidden) return null;

                    return (
                      <td
                        key={colIdx}
                        rowSpan={merge?.rowSpan}
                        colSpan={merge?.colSpan}
                        className="border border-slate-300 px-2 py-1 whitespace-nowrap text-slate-700"
                      >
                        {cell != null ? String(cell) : ''}
                      </td>
                    );
                  },
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
