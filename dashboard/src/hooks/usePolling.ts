import { useState, useEffect, useRef, useCallback } from 'react';

export function usePolling<T>(url: string, intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) {
        setData(json.data);
        setLastUpdated(json.timestamp || Date.now());
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e as Error);
      }
    }
  }, [url]);

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
