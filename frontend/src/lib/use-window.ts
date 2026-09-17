import { useEffect, useState } from "react";

// Keep one bounded window, not an ever-growing copy of Worker data.
export function useWindow<T>(
  fetcher: (start: number, count: number) => Promise<T[]>,
  length: number,
  from: number,
  to: number,
) {
  const start = Math.max(0, Math.floor(from / 64) * 64 - 64);
  const count = Math.min(256, length - start, Math.max(192, to - start + 1));
  const [window, setWindow] = useState<{ start: number; rows: T[] }>({
    start: 0,
    rows: [],
  });
  const [error, setError] = useState("");
  useEffect(() => {
    let ignore = false;
    if (count > 0)
      void fetcher(start, count)
        .then((rows) => {
          if (!ignore) {
            setWindow({ start, rows });
            setError("");
          }
        })
        .catch((cause) => {
          if (!ignore)
            setError(
              cause instanceof Error ? cause.message : "Could not load rows.",
            );
        });
    return () => {
      ignore = true;
    };
  }, [fetcher, start, count]);
  return {
    lookup: (index: number) => window.rows[index - window.start],
    error,
  };
}
