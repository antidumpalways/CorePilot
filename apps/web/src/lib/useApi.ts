import { useCallback, useEffect, useState } from "react";
import type { ApiResult } from "./api";

export interface ApiResource<T> {
  result: ApiResult<T> | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs an async API loader, tracking loading state and exposing a reload().
 * Loaders are expected to resolve (never reject) — API helpers fall back to demo data.
 */
export function useApiResource<T>(
  loader: () => Promise<ApiResult<T>>,
  deps: ReadonlyArray<unknown>,
): ApiResource<T> {
  const [result, setResult] = useState<ApiResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch(() => {
        /* helpers never reject */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  return { result, loading, reload };
}
