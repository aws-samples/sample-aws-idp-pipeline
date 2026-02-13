import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';
import type { PromptType } from '../components/SystemPromptModal';

interface PromptTab {
  type: PromptType;
  onLoad: () => Promise<string>;
  onSave: (content: string) => Promise<void>;
}

interface UseSystemPromptsOptions {
  fetchApi: <T>(url: string, init?: RequestInit) => Promise<T>;
}

export function useSystemPrompts({ fetchApi }: UseSystemPromptsOptions) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const SEPARATOR = '\n---\n';

  const loadSystemPrompt = useCallback(async () => {
    try {
      const data = await fetchApi<{ content: string }>('prompts/system');
      return data.content;
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveSystemPrompt = useCallback(
    async (content: string) => {
      await fetchApi('prompts/system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      showToast('success', t('systemPrompt.saveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadVoiceSystemPrompt = useCallback(async () => {
    try {
      const data = await fetchApi<{ content: string }>('prompts/voice-system');
      return data.content;
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveVoiceSystemPrompt = useCallback(
    async (content: string) => {
      await fetchApi('prompts/voice-system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      showToast('success', t('voiceSystemPrompt.saveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadWebcrawlerPrompt = useCallback(async () => {
    try {
      const data = await fetchApi<{ content: string }>('prompts/webcrawler');
      return data.content;
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveWebcrawlerPrompt = useCallback(
    async (content: string) => {
      await fetchApi('prompts/webcrawler', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      showToast('success', t('systemPrompt.webcrawlerSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadAnalysisDocPrompt = useCallback(async () => {
    try {
      const [system, userQuery, image] = await Promise.all([
        fetchApi<{ content: string }>('prompts/analysis/system'),
        fetchApi<{ content: string }>('prompts/analysis/user-query'),
        fetchApi<{ content: string }>('prompts/analysis/image'),
      ]);
      return [system.content, userQuery.content, image.content].join(SEPARATOR);
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveAnalysisDocPrompt = useCallback(
    async (content: string) => {
      const parts = content.split(SEPARATOR);
      const keys = ['system', 'user-query', 'image'];
      await Promise.all(
        keys.map((key, i) =>
          fetchApi(`prompts/analysis/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parts[i] || '' }),
          }),
        ),
      );
      showToast('success', t('systemPrompt.analysisDocSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadAnalysisVideoPrompt = useCallback(async () => {
    try {
      const [system, userQuery, video] = await Promise.all([
        fetchApi<{ content: string }>('prompts/analysis/video-system'),
        fetchApi<{ content: string }>('prompts/analysis/video-user-query'),
        fetchApi<{ content: string }>('prompts/analysis/video'),
      ]);
      return [system.content, userQuery.content, video.content].join(SEPARATOR);
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveAnalysisVideoPrompt = useCallback(
    async (content: string) => {
      const parts = content.split(SEPARATOR);
      const keys = ['video-system', 'video-user-query', 'video'];
      await Promise.all(
        keys.map((key, i) =>
          fetchApi(`prompts/analysis/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parts[i] || '' }),
          }),
        ),
      );
      showToast('success', t('systemPrompt.analysisVideoSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const loadAnalysisTextPrompt = useCallback(async () => {
    try {
      const [system, userQuery] = await Promise.all([
        fetchApi<{ content: string }>('prompts/analysis/text-system'),
        fetchApi<{ content: string }>('prompts/analysis/text-user-query'),
      ]);
      return [system.content, userQuery.content].join(SEPARATOR);
    } catch {
      return '';
    }
  }, [fetchApi]);

  const saveAnalysisTextPrompt = useCallback(
    async (content: string) => {
      const parts = content.split(SEPARATOR);
      const keys = ['text-system', 'text-user-query'];
      await Promise.all(
        keys.map((key, i) =>
          fetchApi(`prompts/analysis/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parts[i] || '' }),
          }),
        ),
      );
      showToast('success', t('systemPrompt.analysisTextSaveSuccess'));
    },
    [fetchApi, showToast, t],
  );

  const systemPromptTabs = useMemo<PromptTab[]>(
    () => [
      { type: 'chat', onLoad: loadSystemPrompt, onSave: saveSystemPrompt },
      {
        type: 'voice',
        onLoad: loadVoiceSystemPrompt,
        onSave: saveVoiceSystemPrompt,
      },
      {
        type: 'webcrawler',
        onLoad: loadWebcrawlerPrompt,
        onSave: saveWebcrawlerPrompt,
      },
      {
        type: 'analysis-doc',
        onLoad: loadAnalysisDocPrompt,
        onSave: saveAnalysisDocPrompt,
      },
      {
        type: 'analysis-video',
        onLoad: loadAnalysisVideoPrompt,
        onSave: saveAnalysisVideoPrompt,
      },
      {
        type: 'analysis-text',
        onLoad: loadAnalysisTextPrompt,
        onSave: saveAnalysisTextPrompt,
      },
    ],
    [
      loadSystemPrompt,
      saveSystemPrompt,
      loadVoiceSystemPrompt,
      saveVoiceSystemPrompt,
      loadWebcrawlerPrompt,
      saveWebcrawlerPrompt,
      loadAnalysisDocPrompt,
      saveAnalysisDocPrompt,
      loadAnalysisVideoPrompt,
      saveAnalysisVideoPrompt,
      loadAnalysisTextPrompt,
      saveAnalysisTextPrompt,
    ],
  );

  return { systemPromptTabs };
}
