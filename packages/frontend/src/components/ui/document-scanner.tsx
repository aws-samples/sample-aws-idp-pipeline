import { useMemo } from 'react';
import {
  FileText,
  Globe,
  Video,
  Image as ImageIcon,
  Table2,
} from 'lucide-react';

const ASCII_CHARS =
  'abcdefghijklmnopqrstuvwxyz0123456789(){}[]<>;:._-+=!@#$%^&*';

function generateAscii(cols: number, rows: number): string {
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out += ASCII_CHARS[Math.floor(Math.random() * ASCII_CHARS.length)];
    }
    if (r < rows - 1) out += '\n';
  }
  return out;
}

type DocType = 'document' | 'video' | 'web' | 'image' | 'spreadsheet';

const DOC_CONFIG: Record<
  DocType,
  { Icon: typeof FileText; hue: number; iconColor: string }
> = {
  document: {
    Icon: FileText,
    hue: 220,
    iconColor: 'rgba(147, 197, 253, 0.8)',
  },
  video: { Icon: Video, hue: 0, iconColor: 'rgba(252, 165, 165, 0.8)' },
  web: { Icon: Globe, hue: 190, iconColor: 'rgba(103, 232, 249, 0.8)' },
  image: {
    Icon: ImageIcon,
    hue: 270,
    iconColor: 'rgba(196, 181, 253, 0.8)',
  },
  spreadsheet: {
    Icon: Table2,
    hue: 140,
    iconColor: 'rgba(134, 239, 172, 0.8)',
  },
};

function getDocType(fileType?: string): DocType {
  if (!fileType) return 'document';
  const ft = fileType.toLowerCase();
  if (ft.includes('video') || ft.includes('audio')) return 'video';
  if (ft.includes('image')) return 'image';
  if (ft.includes('spreadsheet') || ft.includes('excel') || ft.includes('csv'))
    return 'spreadsheet';
  if (ft === 'application/x-webreq') return 'web';
  return 'document';
}

const CARD_W = 100;
const CARD_H = 130;
const ASCII_COLS = 16;
const ASCII_ROWS = 10;

interface DocumentScannerProps {
  fileType?: string;
  label?: string;
  className?: string;
}

export default function DocumentScanner({
  fileType,
  label,
  className = '',
}: DocumentScannerProps) {
  const docType = getDocType(fileType);
  const config = DOC_CONFIG[docType];
  const Icon = config.Icon;
  const hue = config.hue;

  const ascii = useMemo(() => generateAscii(ASCII_COLS, ASCII_ROWS), []);

  return (
    <div
      className={`flex flex-1 h-full flex-col items-center justify-center gap-4 -mt-8 ${className}`}
    >
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ width: CARD_W, height: CARD_H }}
      >
        {/* Subtle border glow */}
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            boxShadow: `inset 0 0 0 1px hsla(${hue}, var(--ds-line-sat), var(--ds-line-l), 0.2)`,
            animation: 'ds-glow 2s infinite ease-in-out',
          }}
        />

        {/* Icon layer */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: `linear-gradient(160deg, hsl(${hue}, var(--ds-icon-sat), var(--ds-icon-l1)), hsl(${hue}, var(--ds-icon-sat2), var(--ds-icon-l2)))`,
            animation: 'ds-icon-fade 3.5s infinite ease-in-out',
          }}
        >
          <div
            className="absolute w-20 h-20 rounded-full blur-2xl"
            style={{ backgroundColor: `hsla(${hue}, 50%, 40%, 0.12)` }}
          />
          <Icon
            className="w-9 h-9 relative z-10"
            style={{
              color: `hsla(${hue}, var(--ds-text-sat), var(--ds-text-l), 0.8)`,
            }}
            strokeWidth={1.5}
          />
        </div>

        {/* ASCII reveal layer */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden"
          style={{ animation: 'ds-reveal 3.5s infinite ease-in-out' }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(160deg, hsl(${hue}, var(--ds-ascii-sat), var(--ds-ascii-l1)), hsl(${hue}, var(--ds-ascii-sat2), var(--ds-ascii-l2)))`,
            }}
          />
          <pre
            className="absolute inset-0 font-mono text-[9px] leading-[12px] overflow-hidden whitespace-pre p-2 m-0"
            style={{
              color: `hsla(${hue}, var(--ds-text-sat), var(--ds-text-l), 0.6)`,
            }}
          >
            {ascii}
          </pre>
        </div>

        {/* Scanner line */}
        <div
          className="absolute left-0 right-0 h-[2px] z-10"
          style={{
            animation: 'ds-scan 3.5s infinite ease-in-out',
            background: `linear-gradient(to right, transparent 0%, hsl(${hue}, var(--ds-line-sat), var(--ds-line-l)) 20%, hsl(${hue}, var(--ds-line-sat), var(--ds-line-l)) 80%, transparent 100%)`,
            boxShadow: `0 0 6px hsl(${hue}, var(--ds-line-sat), var(--ds-line-l2)), 0 0 12px hsla(${hue}, var(--ds-line-sat), var(--ds-line-l2), 0.5)`,
          }}
        />
      </div>

      {label && (
        <p
          className="text-sm font-medium bg-clip-text"
          style={{
            color: 'transparent',
            backgroundImage: `linear-gradient(90deg, hsla(${hue}, 30%, var(--ds-shimmer-l), 0.6) 0%, hsla(${hue}, 50%, var(--ds-shimmer-l2), 1) 50%, hsla(${hue}, 30%, var(--ds-shimmer-l), 0.6) 100%)`,
            backgroundSize: '200% 100%',
            animation: 'ds-shimmer 2.5s infinite linear',
            WebkitBackgroundClip: 'text',
          }}
        >
          {label}
        </p>
      )}
    </div>
  );
}
