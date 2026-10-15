import { useEffect, useState } from "react";

// Keep one bounded window, not an ever-growing copy of Worker data.
export function useWindow<T>(
  fetcher: (start: number, count: number) => Promise<T[]>,
  length: number,
  from: number,
  to: number,
) {
  const start = Math.max(0, Math.floor(from / 64) * 64 - 64);
  const count = Math.max(0, Math.min(256, length - start, Math.max(192, to - start + 1)));
  const [attempt, setAttempt] = useState(0);
  const [window, setWindow] = useState<{
    fetcher: typeof fetcher;
    start: number;
    count: number;
    attempt: number;
    rows: T[];
    error: string;
  } | null>(null);
  const matches = window?.fetcher === fetcher && window?.start === start && window?.count === count && window?.attempt === attempt;
  useEffect(() => {
    let ignore = false;
    if (count > 0)
      void fetcher(start, count)
        .then((rows) => {
          if (!ignore) {
            setWindow({ fetcher, start, count, attempt, rows, error: "" });
          }
        })
        .catch((cause) => {
          if (!ignore)
            setWindow({ fetcher, start, count, attempt, rows: [], error: cause instanceof Error ? cause.message : "Could not load rows." });
        });
    return () => {
      ignore = true;
    };
  }, [fetcher, start, count, attempt]);
  return {
    lookup: (index: number) => window?.fetcher === fetcher ? window.rows[index - window.start] : undefined,
    error: matches ? window.error : "",
    loading: count > 0 && !matches,
    retry: () => setAttempt((value) => value + 1),
  };
}
