import { useCallback, useEffect, useState } from "react";
import { isApiError } from "./api";

/** Loads something from the API; `reload` fetches it again (after a write, or when a job ends). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(isApiError(e) ? e.detail : String(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export const errorText = (e: unknown) => (isApiError(e) ? (e.status === 409 ? "Changed on disk since you opened it: reload to see the new version." : e.detail) : String(e));

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
