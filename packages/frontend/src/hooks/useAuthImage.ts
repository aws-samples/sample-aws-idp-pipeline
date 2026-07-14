import { useEffect, useState } from 'react';
import { useAwsClient } from './useAwsClient';

/**
 * Loads an image from an Authorization-protected backend path and returns an
 * object URL usable as an <img src>. The request is signed via fetchApiBlob;
 * the resulting blob URL is revoked on cleanup / path change.
 *
 * @param path Backend API path (e.g. `templates/{id}/thumbnail`), or null/undefined to skip.
 */
export function useAuthImage(path?: string | null): {
  src: string | null;
  loading: boolean;
  error: boolean;
} {
  const { fetchApiBlob } = useAwsClient();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      setError(false);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    setLoading(true);
    setError(false);

    fetchApiBlob(path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, fetchApiBlob]);

  return { src, loading, error };
}
