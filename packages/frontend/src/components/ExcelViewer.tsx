import { useState, useEffect, useRef } from 'react';
import { Workbook } from 'exceljs';
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

interface ParsedSheet {
  name: string;
  rows: (string | number | boolean)[][];
  mergeMap: Map<string, MergeInfo>;
}

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function parseCellRef(ref: string): [row: number, col: number] {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return [0, 0];
  return [parseInt(m[2], 10) - 1, colToIndex(m[1])];
}

function resolveCellValue(v: unknown): string | number | boolean {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return v;
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === 'object' && v !== null) {
    if ('richText' in v) {
      const rt = v as { richText: { text: string }[] };
      return rt.richText.map((r) => r.text).join('');
    }
    if ('result' in v) {
      return resolveCellValue((v as { result: unknown }).result);
    }
    if ('error' in v) {
      return String((v as { error: unknown }).error);
    }
  }
  return String(v);
}

function buildMergeMap(merges: string[]): Map<string, MergeInfo> {
  const map = new Map<string, MergeInfo>();
  for (const range of merges) {
    const parts = range.split(':');
    if (parts.length !== 2) continue;
    const [sr, sc] = parseCellRef(parts[0]);
    const [er, ec] = parseCellRef(parts[1]);
    const rowSpan = er - sr + 1;
    const colSpan = ec - sc + 1;

    map.set(`${sr}:${sc}`, { rowSpan, colSpan });

    for (let r = sr; r <= er; r++) {
      for (let c = sc; c <= ec; c++) {
        if (r === sr && c === sc) continue;
        map.set(`${r}:${c}`, { hidden: true });
      }
    }
  }
  return map;
}

async function parseWorkbook(data: ArrayBuffer): Promise<ParsedSheet[]> {
  const wb = await new Workbook().xlsx.load(data as unknown as Buffer);
  return wb.worksheets.map((ws) => {
    const rowCount = ws.rowCount;
    const colCount = ws.columnCount;
    const rows: (string | number | boolean)[][] = [];

    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const rowData: (string | number | boolean)[] = [];
      for (let c = 1; c <= colCount; c++) {
        rowData.push(resolveCellValue(row.getCell(c).value));
      }
      rows.push(rowData);
    }

    const merges = (ws.model?.merges ?? []) as string[];
    return { name: ws.name, rows, mergeMap: buildMergeMap(merges) };
  });
}

export default function ExcelViewer({
  url,
  sheetIndex = 0,
  className = '',
}: ExcelViewerProps) {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
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
      .then(async (buf) => {
        if (controller.signal.aborted) return;
        const parsed = await parseWorkbook(buf);
        setSheets(parsed);
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

  if (sheets.length === 0) return null;

  const clampedIndex = Math.min(sheetIndex, sheets.length - 1);
  const sheet = sheets[clampedIndex];

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200">
        <span className="text-xs font-medium text-slate-500">{sheet.name}</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm">
          <tbody>
            {sheet.rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, colIdx) => {
                  const key = `${rowIdx}:${colIdx}`;
                  const merge = sheet.mergeMap.get(key);

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
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
