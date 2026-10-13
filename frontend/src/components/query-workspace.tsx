import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, Eraser, Play, Save, WandSparkles, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  LOG_COLUMNS,
  QUERIES,
  SQL_LIMIT,
  type QueryPreset,
  type QueryResult,
} from "@/lib/queries";
import type { LogWorkerClient } from "@/lib/worker/log-client";
import type { LogSummary } from "@/lib/worker/messages";
import { format } from "sql-formatter";

const SqlEditor = lazy(() => import("./sql-editor"));

export default function QueryWorkspace({
  client,
  summary,
  sql,
  onSql,
  history,
  onHistory,
  saved,
  onSaved,
  disabled,
  autoRun,
}: {
  client: LogWorkerClient;
  summary: LogSummary;
  sql: string;
  onSql: (sql: string) => void;
  history: string[];
  onHistory: (history: string[]) => void;
  saved: { name: string; sql: string }[];
  onSaved: (saved: { name: string; sql: string }[]) => void;
  disabled: boolean;
  autoRun?: boolean;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const run = useCallback(async (text: string, recordHistory = true) => {
    const id = ++generation.current;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const value = await client.query(summary.revision, text);
      if (generation.current !== id) return;
      setResult(value);
      if (recordHistory)
        onHistory(
          [text, ...history.filter((entry) => entry !== text)].slice(0, 20),
        );
    } catch (cause) {
      if (generation.current === id)
        setError(cause instanceof Error ? cause.message : "Query failed.");
    } finally {
      if (generation.current === id) setBusy(false);
    }
  }, [client, history, onHistory, summary.revision]);

  const autoRunRevision = useRef<number | null>(null);
  useEffect(() => {
    if (
      !autoRun ||
      !sql.trim() ||
      autoRunRevision.current === summary.revision
    )
      return;
    autoRunRevision.current = summary.revision;
    void run(sql, false);
  }, [autoRun, run, sql, summary.revision]);

  function pretty() {
    try {
      onSql(format(sql, { language: "duckdb", keywordCase: "upper" }));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not format: ${cause.message}`
          : "Could not format query.",
      );
    }
  }

  function clear() {
    // A query cannot be cancelled yet, but its eventual response must not
    // resurrect results after the user explicitly cleared the workspace.
    generation.current++;
    setBusy(false);
    onSql("");
    setResult(null);
    setError("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || disabled || !sql.trim()}
          onClick={() => void run(sql)}
        >
          <Play size={13} />
          Run query
        </Button>
        <Button size="sm" variant="outline" onClick={pretty}>
          <WandSparkles size={13} />
          Format
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label="Clear editor"
          onClick={() => {
            clear();
          }}
        >
          <Eraser size={13} />
          Clear
        </Button>
        <span className="text-[10px] text-muted-foreground">
          Ctrl/Cmd + Enter runs. DuckDB SQL over the `logs` table.
        </span>
      </div>
      <div className="h-40 shrink-0 overflow-auto rounded-lg border bg-background">
        <Suspense
          fallback={
            <textarea
              aria-label="SQL query"
              className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs outline-none"
              value={sql}
              onChange={(event) => onSql(event.target.value)}
            />
          }
        >
          <SqlEditor
            value={sql}
            columns={LOG_COLUMNS}
            onChange={onSql}
            onRun={() => void run(sql)}
          />
        </Suspense>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        Starters:
        {(Object.keys(QUERIES) as QueryPreset[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant="ghost"
            disabled={busy || disabled}
            onClick={() => {
              onSql(QUERIES[key].sql);
              void run(QUERIES[key].sql);
            }}
          >
            {QUERIES[key].label}
          </Button>
        ))}
      </div>
      {busy && (
        <p role="status" className="text-xs">
          Running query… First run loads local WASM and indexes this dataset.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            {(result.rows.length + result.truncated).toLocaleString()} {result.truncated > 0 ? "rows returned · " : "rows · "}
            {result.truncated > 0 && `${result.rows.length.toLocaleString()} shown · `}
            {result.elapsedMs.toFixed(1)} ms SQL execution (excludes loading)
          </p>
          {result.truncated > 0 && (
            <p className="text-[10px] text-amber-300">
              Showing {SQL_LIMIT.toLocaleString()} of{" "}
              {(result.rows.length + result.truncated).toLocaleString()} rows.
              Add a LIMIT or aggregate in SQL to see the rest.
            </p>
          )}
          <div className="h-48 min-h-24 max-h-[40vh] shrink-0 overflow-auto rounded-lg border">
            <table
              aria-label="SQL results"
              className="w-full text-left font-mono text-xs"
            >
              <thead className="sticky top-0 bg-card">
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
      <div className="grid shrink-0 gap-3 sm:grid-cols-2">
        <section aria-label="Saved queries" className="rounded-lg border p-3">
          <h3 className="mb-2 text-xs font-medium">Saved queries</h3>
          <div className="mb-2 flex gap-2">
            <input
              aria-label="Saved query name"
              className="min-w-0 flex-1 rounded border bg-background p-2 text-xs"
              placeholder="Name this query"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!name.trim() || !sql.trim()}
              onClick={() => {
                onSaved([
                  ...saved.filter((entry) => entry.name !== name.trim()),
                  { name: name.trim(), sql },
                ]);
                setName("");
              }}
            >
              <Save size={13} />
              Save
            </Button>
          </div>
          {saved.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              Saved queries are stored locally in this browser.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {saved.map((entry) => (
                <li key={entry.name} className="flex items-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={entry.sql}
                    onClick={() => onSql(entry.sql)}
                  >
                    {entry.name}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove saved query ${entry.name}`}
                    onClick={() =>
                      onSaved(saved.filter((item) => item.name !== entry.name))
                    }
                  >
                    <X size={12} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Query history" className="rounded-lg border p-3">
          <h3 className="mb-2 text-xs font-medium">History</h3>
          {history.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              Queries you run are stored locally in this browser.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {history.map((entry, index) => (
                <li key={`${index}-${entry}`}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="max-w-full justify-start"
                    aria-label={`Use history ${index + 1}`}
                    title={entry}
                    onClick={() => onSql(entry)}
                  >
                    <Check size={12} />
                    <span className="truncate font-mono text-[10px]">
                      {entry}
                    </span>
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
