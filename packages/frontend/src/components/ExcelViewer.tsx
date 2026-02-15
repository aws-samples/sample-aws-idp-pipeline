import { useState, useEffect, useRef } from 'react';
import { Workbook as ExcelWorkbook } from 'exceljs';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { Loader2 } from 'lucide-react';

interface ExcelViewerProps {
  url: string;
  sheetIndex?: number;
  className?: string;
}

interface FSCell {
  v?: string | number | boolean;
  m?: string | number;
  bg?: string;
  fc?: string;
  bl?: number;
  it?: number;
  fs?: number;
  ff?: number | string;
  ht?: number;
  vt?: number;
  mc?: { r: number; c: number; rs?: number; cs?: number };
}

interface FSCellData {
  r: number;
  c: number;
  v: FSCell | null;
}

interface FSSheet {
  name: string;
  id: string;
  row: number;
  column: number;
  celldata: FSCellData[];
  config: {
    merge: Record<string, { r: number; c: number; rs: number; cs: number }>;
    rowlen: Record<string, number>;
    columnlen: Record<string, number>;
  };
  status: number;
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

function resolveCellValue(v: unknown): string | number | boolean | undefined {
  if (v == null) return undefined;
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

function getAlignmentH(
  h?:
    | 'left'
    | 'center'
    | 'right'
    | 'fill'
    | 'justify'
    | 'centerContinuous'
    | 'distributed',
): number | undefined {
  switch (h) {
    case 'left':
      return 1;
    case 'center':
    case 'centerContinuous':
      return 0;
    case 'right':
      return 2;
    default:
      return undefined;
  }
}

function getAlignmentV(
  v?: 'top' | 'middle' | 'bottom' | 'justify' | 'distributed',
): number | undefined {
  switch (v) {
    case 'top':
      return 1;
    case 'middle':
      return 0;
    case 'bottom':
      return 2;
    default:
      return undefined;
  }
}

function extractArgbColor(color?: {
  argb?: string;
  theme?: number;
  tint?: number;
}): string | undefined {
  if (!color) return undefined;
  if (color.argb) {
    const hex = color.argb;
    // ARGB format: first 2 chars = alpha, rest = RGB
    if (hex.length === 8) return '#' + hex.substring(2);
    if (hex.length === 6) return '#' + hex;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertCell(excelCell: any): FSCell | null {
  const val = resolveCellValue(excelCell.value);
  if (val === undefined) return null;

  const cell: FSCell = {
    v: val,
    m: String(val),
  };

  const style = excelCell.style;
  if (!style) return cell;

  // Background color
  if (style.fill) {
    const fill = style.fill;
    if (fill.type === 'pattern' && fill.fgColor) {
      const bg = extractArgbColor(fill.fgColor);
      if (bg) cell.bg = bg;
    }
  }

  // Font styling
  if (style.font) {
    const font = style.font;
    if (font.bold) cell.bl = 1;
    if (font.italic) cell.it = 1;
    if (font.size) cell.fs = font.size;
    if (font.name) cell.ff = font.name;
    if (font.color) {
      const fc = extractArgbColor(font.color);
      if (fc) cell.fc = fc;
    }
  }

  // Alignment
  if (style.alignment) {
    const ht = getAlignmentH(style.alignment.horizontal);
    if (ht !== undefined) cell.ht = ht;
    const vt = getAlignmentV(style.alignment.vertical);
    if (vt !== undefined) cell.vt = vt;
  }

  return cell;
}

async function convertWorkbookToSheets(data: ArrayBuffer): Promise<FSSheet[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wb = await new ExcelWorkbook().xlsx.load(data as any);

  return wb.worksheets.map((ws, idx) => {
    const rowCount = ws.rowCount;
    const colCount = ws.columnCount;
    const celldata: FSCellData[] = [];
    const merge: Record<
      string,
      { r: number; c: number; rs: number; cs: number }
    > = {};
    const rowlen: Record<string, number> = {};
    const columnlen: Record<string, number> = {};

    // Convert cells (exceljs is 1-indexed, FortuneSheet is 0-indexed)
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      if (row.height) {
        rowlen[String(r - 1)] = row.height * 1.33; // pt to px
      }

      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        const converted = convertCell(cell);
        if (converted) {
          celldata.push({ r: r - 1, c: c - 1, v: converted });
        }
      }
    }

    // Convert column widths
    for (let c = 1; c <= colCount; c++) {
      const col = ws.getColumn(c);
      if (col.width) {
        columnlen[String(c - 1)] = col.width * 7.5; // char width to px
      }
    }

    // Convert merges
    const merges = (ws.model?.merges ?? []) as string[];
    for (const mergeRange of merges) {
      const parts = mergeRange.split(':');
      if (parts.length !== 2) continue;
      const [sr, sc] = parseCellRef(parts[0]);
      const [er, ec] = parseCellRef(parts[1]);
      const rs = er - sr + 1;
      const cs = ec - sc + 1;

      const key = `${sr}_${sc}`;
      merge[key] = { r: sr, c: sc, rs, cs };

      // Mark merged cells with mc property in celldata
      for (let r = sr; r <= er; r++) {
        for (let c = sc; c <= ec; c++) {
          if (r === sr && c === sc) {
            // Primary cell: find existing or create, add mc with span info
            const existing = celldata.find((cd) => cd.r === sr && cd.c === sc);
            if (existing && existing.v) {
              existing.v.mc = { r: sr, c: sc, rs, cs };
            } else {
              celldata.push({
                r: sr,
                c: sc,
                v: { v: '', m: '', mc: { r: sr, c: sc, rs, cs } },
              });
            }
          } else {
            // Covered cell: mc points to primary cell (no rs/cs)
            celldata.push({
              r,
              c,
              v: { mc: { r: sr, c: sc } },
            });
          }
        }
      }
    }

    return {
      name: ws.name,
      id: String(idx),
      row: rowCount,
      column: colCount,
      celldata,
      config: {
        merge,
        rowlen,
        columnlen,
      },
      status: idx === 0 ? 1 : 0,
    };
  });
}

export default function ExcelViewer({
  url,
  sheetIndex = 0,
  className = '',
}: ExcelViewerProps) {
  const [sheets, setSheets] = useState<FSSheet[] | null>(null);
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
        const converted = await convertWorkbookToSheets(buf);
        // Set the active sheet based on sheetIndex
        const clampedIdx = Math.min(sheetIndex, converted.length - 1);
        for (let i = 0; i < converted.length; i++) {
          converted[i].status = i === clampedIdx ? 1 : 0;
        }
        setSheets(converted);
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
  }, [url, sheetIndex]);

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

  if (!sheets || sheets.length === 0) return null;

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      <Workbook
        data={sheets}
        allowEdit={false}
        showToolbar={false}
        showFormulaBar={false}
        showSheetTabs={sheets.length > 1}
      />
    </div>
  );
}
