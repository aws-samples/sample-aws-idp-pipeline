import { useEffect, useState } from 'react';
import { useAwsClient } from './useAwsClient';
import { CHAT_MODELS, type ChatModel } from '../components/ChatPanel/models';

/**
 * Loads the chat model catalog from the backend (GET /chat/models, backed by
 * the SSM parameter /idp-v2/chat/models). Falls back to the built-in
 * CHAT_MODELS list while loading or if the request fails, so the selector
 * always has something to show. Adding/removing a model is done by editing the
 * SSM parameter - no redeploy needed.
 */
export interface ModelCatalog {
  models: ChatModel[];
  /** True once the API responded (success or failure). Until then `models` is
   *  the built-in fallback, so callers should defer catalog-dependent
   *  validation (e.g. dropping a session's remembered model) until loaded. */
  loaded: boolean;
}

export function useModelCatalog(): ModelCatalog {
  const { fetchApi } = useAwsClient();
  const [models, setModels] = useState<ChatModel[]>(CHAT_MODELS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApi<{ models: ChatModel[] }>('chat/models');
        if (!cancelled && data?.models?.length) {
          setModels(data.models);
        }
      } catch {
        // Keep the built-in fallback list.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchApi]);

  return { models, loaded };
}
