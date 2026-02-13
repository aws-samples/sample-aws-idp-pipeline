import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Image,
  Film,
  FileCode,
  FileSpreadsheet,
  File,
  Music,
  Globe,
  Presentation,
} from 'lucide-react';

// --- MIME type constants ---

export const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

// --- Boolean type checks ---

export const isTextFileType = (fileType: string | undefined): boolean => {
  if (!fileType) return false;
  return TEXT_MIME_TYPES.includes(fileType);
};

export const isMarkdownFileType = (fileType: string | undefined): boolean => {
  return fileType === 'text/markdown';
};

export const isSpreadsheetFileType = (
  fileType: string | undefined,
): boolean => {
  if (!fileType) return false;
  return [
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ].includes(fileType);
};

export const isExcelFileType = (fileType: string | undefined): boolean => {
  if (!fileType) return false;
  return [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ].includes(fileType);
};

export const isPdfFileType = (fileType: string | undefined): boolean => {
  return fileType === 'application/pdf';
};

export const isImageFileType = (fileType: string | undefined): boolean => {
  if (!fileType) return false;
  return fileType.startsWith('image/');
};

export const isDocxFileType = (fileType: string | undefined): boolean => {
  if (!fileType) return false;
  return (
    fileType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileType === 'application/msword'
  );
};

export const isPptxFileType = (fileType: string | undefined): boolean => {
  if (!fileType) return false;
  return (
    fileType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    fileType === 'application/vnd.ms-powerpoint'
  );
};

// --- Labels ---

export const FILE_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'DOCX',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'PPTX',
  'application/vnd.ms-powerpoint': 'PPT',
  'text/plain': 'TXT',
  'text/markdown': 'Markdown',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/tiff': 'TIFF',
  'video/mp4': 'MP4',
  'audio/mpeg': 'MP3',
  'application/x-webreq': 'Web',
};

export const getFileTypeLabel = (fileType: string | undefined): string => {
  if (!fileType) return 'PDF';
  return FILE_TYPE_LABELS[fileType] || fileType;
};

// --- Category (for document filtering) ---

export const getFileTypeCategory = (fileType: string): string => {
  if (fileType.includes('pdf')) return 'pdf';
  if (fileType.startsWith('image/')) return 'image';
  if (fileType.startsWith('video/') || fileType.startsWith('audio/'))
    return 'media';
  if (fileType.includes('webreq')) return 'web';
  if (
    fileType.includes('spreadsheetml') ||
    fileType.includes('ms-excel') ||
    fileType === 'text/csv'
  )
    return 'spreadsheet';
  if (fileType.includes('presentationml') || fileType.includes('ms-powerpoint'))
    return 'presentation';
  if (fileType.includes('wordprocessing') || fileType.includes('msword'))
    return 'document';
  return 'text';
};

// --- Icon components (returns LucideIcon class, not JSX) ---

export function getArtifactIcon(contentType: string): LucideIcon {
  if (contentType.startsWith('image/')) return Image;
  if (contentType.startsWith('video/')) return Film;
  if (contentType === 'application/pdf') return FileText;
  if (isDocxFileType(contentType)) return FileText;
  if (isPptxFileType(contentType)) return Presentation;
  if (isSpreadsheetFileType(contentType)) return FileSpreadsheet;
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/javascript'
  )
    return FileCode;
  return File;
}

export function getArtifactIconClass(contentType: string): string {
  if (contentType.startsWith('image/')) return 'bg-purple-500';
  if (contentType.startsWith('video/')) return 'bg-pink-500';
  if (contentType === 'application/pdf') return 'bg-red-500';
  if (isDocxFileType(contentType)) return 'bg-indigo-500';
  if (isPptxFileType(contentType)) return 'bg-orange-500';
  if (isSpreadsheetFileType(contentType)) return 'bg-green-500';
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/javascript'
  )
    return 'bg-blue-500';
  return 'bg-slate-500';
}

// --- File icon for SidePanel (returns { icon, className }) ---

export function getFileIconComponent(fileType: string): {
  icon: LucideIcon;
  className: string;
} {
  if (fileType.includes('pdf'))
    return { icon: FileText, className: 'h-5 w-5 text-blue-400' };
  if (fileType.includes('image'))
    return { icon: Image, className: 'h-5 w-5 text-emerald-400' };
  if (fileType.includes('video'))
    return { icon: Film, className: 'h-5 w-5 text-violet-400' };
  if (fileType.includes('audio'))
    return { icon: Music, className: 'h-5 w-5 text-amber-400' };
  if (fileType.includes('webreq'))
    return { icon: Globe, className: 'h-5 w-5 text-cyan-400' };
  if (fileType.includes('presentationml') || fileType.includes('ms-powerpoint'))
    return { icon: Presentation, className: 'h-5 w-5 text-orange-400' };
  if (
    fileType.includes('spreadsheetml') ||
    fileType.includes('ms-excel') ||
    fileType === 'text/csv'
  )
    return { icon: FileSpreadsheet, className: 'h-5 w-5 text-green-400' };
  if (fileType === 'text/markdown')
    return { icon: FileCode, className: 'h-5 w-5 text-indigo-400' };
  if (fileType.includes('wordprocessing') || fileType.includes('msword'))
    return { icon: FileText, className: 'h-5 w-5 text-blue-500' };
  if (fileType === 'text/plain')
    return { icon: FileText, className: 'h-5 w-5 text-slate-500' };
  return { icon: File, className: 'h-5 w-5 text-slate-400' };
}

// --- Extension-based file type info (for ChatPanel) ---

export const getFileTypeInfo = (
  filename: string,
): { icon: LucideIcon; color: string; bgColor: string } => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return {
        icon: FileText,
        color: 'text-red-500',
        bgColor: 'bg-red-100 dark:bg-red-900/30',
      };
    case 'doc':
    case 'docx':
      return {
        icon: FileText,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      };
    case 'xls':
    case 'xlsx':
    case 'csv':
      return {
        icon: FileSpreadsheet,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
      };
    case 'html':
    case 'md':
      return {
        icon: FileCode,
        color: 'text-purple-500',
        bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      };
    case 'txt':
      return {
        icon: File,
        color: 'text-slate-500',
        bgColor: 'bg-slate-100 dark:bg-slate-600',
      };
    default:
      return {
        icon: File,
        color: 'text-slate-500',
        bgColor: 'bg-slate-100 dark:bg-slate-600',
      };
  }
};

// --- Shared formatFileSize ---

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
