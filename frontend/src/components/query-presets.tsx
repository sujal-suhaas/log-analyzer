import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { QUERIES, type QueryPreset, type QueryResult } from "@/lib/queries";
import type { LogWorkerClient } from "@/lib/worker/log-client";

export function QueryPresets({
  client,
  revision,
  disabled,
}: {
  client: LogWorkerClient;
  revision: number;
  disabled: boolean;
}) {
  const [preset, setPreset] = useState<QueryPreset>("count");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function run(next: QueryPreset) {
    const id = ++generation.current;
    setPreset(next);
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const value = await client.query(revision, next);
      if (generation.current === id) setResult(value);
    } catch (cause) {
      if (generation.current === id)
        setError(cause instanceof Error ? cause.message : "Query failed.");
    } finally {
      if (generation.current === id) setBusy(false);
    }
  }
  return (
    <details className="mx-4 mb-3 shrink-0 rounded-lg border bg-card p-3 sm:mx-7">
      <summary className="cursor-pointer text-xs font-medium">
        SQL presets · DuckDB
      </summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(QUERIES) as QueryPreset[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant="outline"
            disabled={busy || disabled}
            onClick={() => void run(key)}
          >
            {QUERIES[key].label}
          </Button>
        ))}
      </div>
      <pre className="my-3 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
        {QUERIES[preset].sql}
      </pre>
      {busy && (
        <p role="status" className="text-xs">
          Loading database / running query… First run loads local WASM and
          indexes this dataset.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status" className="mb-2 text-xs text-muted-foreground">
            {result.rows.length} rows · {result.elapsedMs.toFixed(1)} ms SQL
            execution (excludes loading)
          </p>
          <div className="max-h-48 overflow-auto">
            <table
              aria-label="SQL results"
              className="w-full text-left font-mono text-xs"
            >
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column} className="border-b p-2">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((value, cell) => (
                      <td
                        key={cell}
                        className="max-w-80 truncate border-b p-2"
                        title={value}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Typed core fields, extras JSON, raw source and parse_error. Latest logs
        limited to 100. Data stays in this tab.
      </p>
    </details>
  );
}
