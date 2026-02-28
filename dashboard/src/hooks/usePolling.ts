import { useState, useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  /** If true, expect raw JSON (no { data, timestamp } wrapper). Default: false */
  raw?: boolean;
}

export function usePolling<T>(url: string, intervalMs = 5000, options?: UsePollingOptions) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const mountedRef = useRef(true);
  const raw = options?.raw ?? false;

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) {
        if (raw) {
          setData(json as T);
        } else {
          // Legacy wrapper format: { data: T, timestamp: number }
          setData(json.data ?? json);
        }
        setLastUpdated(json.timestamp || Date.now());
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e as Error);
      }
    }
  }, [url, raw]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchData, intervalMs]);

  return { data, error, lastUpdated };
}
