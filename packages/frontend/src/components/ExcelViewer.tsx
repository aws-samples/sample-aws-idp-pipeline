import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Workbook as ExcelWorkbook } from 'exceljs';
import JSZip from 'jszip';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { Loader2, Info } from 'lucide-react';

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

interface ConvertResult {
  sheets: FSSheet[];
  warnings: string[];
}

function convertWorksheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  idx: number,
  warnings: string[],
): FSSheet {
  const rowCount = ws.rowCount ?? 0;
  const colCount = ws.columnCount ?? 0;
  const celldata: FSCellData[] = [];
  const merge: Record<
    string,
    { r: number; c: number; rs: number; cs: number }
  > = {};
  const rowlen: Record<string, number> = {};
  const columnlen: Record<string, number> = {};

  // Detect images
  try {
    if (typeof ws.getImages === 'function' && ws.getImages().length > 0) {
      warnings.push('images');
    }
  } catch {
    // getImages() not supported or failed
  }

  // Detect charts via model
  try {
    const model = ws.model;
    if (model?.charts?.length || model?.drawing?.length) {
      warnings.push('charts');
    }
  } catch {
    // chart detection not supported
  }

  // Convert cells (exceljs is 1-indexed, FortuneSheet is 0-indexed)
  for (let r = 1; r <= rowCount; r++) {
    try {
      const row = ws.getRow(r);
      if (row.height) {
        rowlen[String(r - 1)] = row.height * 1.33; // pt to px
      }

      for (let c = 1; c <= colCount; c++) {
        try {
          const cell = row.getCell(c);
          const converted = convertCell(cell);
          if (converted) {
            celldata.push({ r: r - 1, c: c - 1, v: converted });
          }
        } catch {
          // Skip cells that fail to convert
        }
      }
    } catch {
      // Skip rows that fail to read
    }
  }

  // Convert column widths
  try {
    for (let c = 1; c <= colCount; c++) {
      const col = ws.getColumn(c);
      if (col.width) {
        columnlen[String(c - 1)] = col.width * 7.5; // char width to px
      }
    }
  } catch {
    // Skip column width conversion on error
  }

  // Convert merges
  try {
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
  } catch {
    // Skip merge conversion on error
  }

  return {
    name: ws.name || `Sheet ${idx + 1}`,
    id: String(idx),
    row: Math.max(rowCount, 1),
    column: Math.max(colCount, 1),
    celldata,
    config: {
      merge,
      rowlen,
      columnlen,
    },
    status: idx === 0 ? 1 : 0,
  };
}

async function stripDrawingsFromXlsx(
  data: ArrayBuffer,
): Promise<{ data: ArrayBuffer; warnings: string[] }> {
  const zip = await JSZip.loadAsync(data);
  const warnings: string[] = [];

  // 1. Detect and remove drawing/chart/media files
  const toRemove: string[] = [];
  zip.forEach((path) => {
    const p = path.toLowerCase();
    if (
      p.startsWith('xl/drawings/') ||
      p.startsWith('xl/charts/') ||
      p.startsWith('xl/chartsheets/') ||
      p.startsWith('xl/media/')
    ) {
      toRemove.push(path);
      if (p.startsWith('xl/drawings/') || p.startsWith('xl/media/'))
        warnings.push('images');
      if (p.startsWith('xl/charts/') || p.startsWith('xl/chartsheets/'))
        warnings.push('charts');
    }
  });

  if (toRemove.length === 0) {
    throw new Error('No readable worksheets found');
  }

  for (const path of toRemove) {
    zip.remove(path);
  }

  // 2. Remove drawing/chart references from .rels files
  const relsFiles: string[] = [];
  zip.forEach((path) => {
    if (path.endsWith('.rels')) relsFiles.push(path);
  });

  for (const relsPath of relsFiles) {
    const file = zip.file(relsPath);
    if (!file) continue;
    const content = await file.async('string');
    const cleaned = content.replace(
      /<Relationship\b[^>]*(?:\/drawings\/|\/charts\/|\/media\/|\/chartsheets\/)[^>]*\/?>/gi,
      '',
    );
    if (cleaned !== content) {
      zip.file(relsPath, cleaned);
    }
  }

  // 3. Strip <drawing> and <legacyDrawing> refs from worksheet XML
  //    so exceljs won't try to resolve them during reconcile
  const worksheetFiles: string[] = [];
  zip.forEach((path) => {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(path)) {
      worksheetFiles.push(path);
    }
  });

  for (const wsPath of worksheetFiles) {
    const file = zip.file(wsPath);
    if (!file) continue;
    const content = await file.async('string');
    const cleaned = content
      .replace(/<drawing\b[^>]*\/>/gi, '')
      .replace(/<drawing\b[^>]*>[\s\S]*?<\/drawing>/gi, '')
      .replace(/<legacyDrawing\b[^>]*\/>/gi, '')
      .replace(/<legacyDrawing\b[^>]*>[\s\S]*?<\/legacyDrawing>/gi, '');
    if (cleaned !== content) {
      zip.file(wsPath, cleaned);
    }
  }

  return {
    data: await zip.generateAsync({ type: 'arraybuffer' }),
    warnings: [...new Set(warnings)],
  };
}

async function convertWorkbookToSheets(
  data: ArrayBuffer,
): Promise<ConvertResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wb: any;
  let fallbackWarnings: string[] = [];

  try {
    wb = await new ExcelWorkbook().xlsx.load(data as ArrayBuffer);
  } catch {
    // exceljs crashes on drawings/charts — strip them and retry
    const sanitized = await stripDrawingsFromXlsx(data);
    fallbackWarnings = sanitized.warnings;
    wb = await new ExcelWorkbook().xlsx.load(sanitized.data as ArrayBuffer);
  }

  const warnings: string[] = [...fallbackWarnings];
  const sheets: FSSheet[] = [];

  for (let idx = 0; idx < wb.worksheets.length; idx++) {
    try {
      const ws = wb.worksheets[idx];
      if (!ws) continue;
      sheets.push(convertWorksheet(ws, idx, warnings));
    } catch {
      // Skip worksheets that fail entirely (e.g. chart sheets)
      warnings.push('charts');
    }
  }

  if (sheets.length === 0) {
    throw new Error('No readable worksheets found');
  }

  return { sheets, warnings: [...new Set(warnings)] };
}

export default function ExcelViewer({
  url,
  sheetIndex = 0,
  className = '',
}: ExcelViewerProps) {
  const { t } = useTranslation();
  const [sheets, setSheets] = useState<FSSheet[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
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
    setWarnings([]);

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then(async (buf) => {
        if (controller.signal.aborted) return;
        const { sheets: converted, warnings: w } =
          await convertWorkbookToSheets(buf);
        // Set the active sheet based on sheetIndex
        const clampedIdx = Math.min(sheetIndex, converted.length - 1);
        for (let i = 0; i < converted.length; i++) {
          converted[i].status = i === clampedIdx ? 1 : 0;
        }
        setSheets(converted);
        setWarnings(w);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load Excel file:', err);
        setError(t('artifacts.loadError', 'Failed to load Excel file'));
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [url, sheetIndex, t]);

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
    <div
      className={`relative flex flex-col overflow-hidden bg-white ${className}`}
    >
      {warnings.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-200 shrink-0">
          <Info className="w-4 h-4 shrink-0" />
          <span>{t('artifacts.excelNote')}</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Workbook
          data={sheets}
          allowEdit={false}
          showToolbar={false}
          showFormulaBar={false}
          showSheetTabs={sheets.length > 1}
        />
      </div>
    </div>
  );
}
