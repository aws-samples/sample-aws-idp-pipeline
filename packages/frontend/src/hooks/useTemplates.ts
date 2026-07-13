import { useState, useCallback } from 'react';
import type { Template } from '../components/TemplateCard';
import type { TemplateUploadResponse } from '../types/project';
import type { TemplateUploadData } from '../components/TemplateUploadModal';

const EXT_MIME: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pdf: 'application/pdf',
};

const getMimeType = (file: File): string => {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
};

interface UseTemplatesOptions {
  fetchApi: <T>(url: string, init?: RequestInit) => Promise<T>;
}

export function useTemplates({ fetchApi }: UseTemplatesOptions) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<Template[]>('templates');
      setTemplates(data);
    } catch (error) {
      console.error('Failed to load templates:', error);
      setTemplates([]);
    }
    setLoading(false);
  }, [fetchApi]);

  const uploadTemplate = useCallback(
    async (data: TemplateUploadData) => {
      setUploading(true);
      try {
        const contentType = getMimeType(data.file);

        // 1) 백엔드에 레코드 생성 + presigned PUT URL 발급 요청
        const uploadInfo = await fetchApi<TemplateUploadResponse>('templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            description: data.description,
            file_name: data.file.name,
            content_type: contentType,
            file_size: data.file.size,
          }),
        });

        // 2) presigned URL로 S3에 파일 직접 업로드
        //    업로드 완료 후 상태 갱신은 S3 이벤트 트리거(Lambda)에서 처리한다.
        const uploadResponse = await fetch(uploadInfo.upload_url, {
          method: 'PUT',
          body: data.file,
          headers: { 'Content-Type': contentType },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload ${data.file.name} to S3`);
        }

        await loadTemplates();
      } catch (error) {
        console.error('Failed to upload template:', error);
        throw error;
      } finally {
        setUploading(false);
      }
    },
    [fetchApi, loadTemplates],
  );

  return {
    templates,
    loading,
    uploading,
    loadTemplates,
    uploadTemplate,
  };
}
