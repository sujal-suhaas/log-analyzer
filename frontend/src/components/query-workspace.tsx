import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, Eraser, Play, Save, Square, WandSparkles, X } from "lucide-react";
import { Button } from "./ui/button";
import { ExportControls } from "./export-controls";
import { TableColumnControls, TableColumnResizeHandle } from "./table-column-controls";
import { useTableColumns } from "@/lib/use-table-columns";
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
  dark,
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
  dark: boolean;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [executedSql, setExecutedSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const layout = useTableColumns((result?.columns ?? []).map((column, index) => ({
    id: `${index}:${column}`, label: column, index, defaultWidth: 220,
  })));
  const generation = useRef(0);
  const running = useRef(false);
  const activeQuery = useRef({ running: false });
  useEffect(
    () => {
      const operation = activeQuery.current;
      return () => {
        generation.current++;
        if (operation.running) void client.cancelQuery().catch(() => {});
      };
    },
    [client],
  );

  const run = useCallback(async (text: string, recordHistory = true) => {
    if (disabled || running.current || !text.trim()) return;
    running.current = true;
    activeQuery.current.running = true;
    const id = ++generation.current;
    setBusy(true);
    setResult(null);
    setError("");
    setCancelled(false);
    try {
      const value = await client.query(summary.revision, text);
      if (generation.current !== id) return;
      setResult(value);
      setExecutedSql(text);
      if (recordHistory)
        onHistory(
          [text, ...history.filter((entry) => entry !== text)].slice(0, 20),
        );
    } catch (cause) {
      if (generation.current === id) {
        if (cause instanceof Error && cause.name === "AbortError") setCancelled(true);
        else setError(cause instanceof Error ? cause.message : "Query failed.");
      }
    } finally {
      if (generation.current === id) {
        running.current = false;
        activeQuery.current.running = false;
        setBusy(false);
      }
    }
  }, [client, disabled, history, onHistory, summary.revision]);

  const autoRunRevision = useRef<number | null>(null);
  useEffect(() => {
    if (
      !autoRun ||
      disabled ||
      !sql.trim() ||
      autoRunRevision.current === summary.revision
    )
      return;
    autoRunRevision.current = summary.revision;
    void run(sql, false);
  }, [autoRun, disabled, run, sql, summary.revision]);

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
    if (running.current) void client.cancelQuery().catch(() => {});
    generation.current++;
    running.current = false;
    activeQuery.current.running = false;
    setBusy(false);
    onSql("");
    setResult(null);
    setError("");
    setCancelled(false);
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
        {busy && (
          <Button size="sm" variant="outline" onClick={() => void client.cancelQuery().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not cancel query."))}>
            <Square size={13} /> Cancel query
          </Button>
        )}
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
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void run(sql);
                }
              }}
            />
          }
        >
          <SqlEditor
            value={sql}
            columns={LOG_COLUMNS}
            onChange={onSql}
            onRun={() => void run(sql)}
            dark={dark}
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
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {cancelled && <p role="status" className="text-xs text-muted-foreground">Query cancelled. Dataset kept; you can run another query.</p>}
      {result && (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            {(result.rows.length + result.truncated).toLocaleString()} {result.truncated > 0 ? "rows returned · " : "rows · "}
            {result.truncated > 0 && `${result.rows.length.toLocaleString()} shown · `}
            {result.elapsedMs.toFixed(1)} ms SQL execution (excludes loading)
          </p>
          <ExportControls
            key={`query-export-${summary.revision}-${executedSql}`}
            kind="query"
            disabled={disabled || busy || sql !== executedSql}
            onExport={(format) => client.exportQuery(summary.revision, format)}
          />
          <p className="text-[10px] text-muted-foreground">
            Export re-runs the last successful SQL in the Worker without the preview cap.
            {sql !== executedSql && " Run the edited query before exporting."}
          </p>
          {result.truncated > 0 && (
            <p className="text-[10px] text-amber-800 dark:text-amber-300">
              Showing {SQL_LIMIT.toLocaleString()} of{" "}
              {(result.rows.length + result.truncated).toLocaleString()} rows.
              Export query results to download every returned row.
            </p>
          )}
          <TableColumnControls
            columns={layout.columns}
            onVisibilityChange={layout.setVisible}
            onWidthChange={layout.setWidth}
            onReset={layout.reset}
          />
          {layout.visibleColumns.length === 0 && <p role="status" className="text-xs text-muted-foreground">All result columns are hidden. Use Columns to show them or Reset columns.</p>}
          <div className="h-48 min-h-24 max-h-[40vh] shrink-0 overflow-auto rounded-lg border">
            <table
              aria-label="SQL results"
              className="min-w-full table-fixed text-left font-mono text-xs"
              style={{ width: layout.totalWidth }}
            >
              <colgroup>{layout.visibleColumns.map((column) => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
              <thead className="sticky top-0 bg-card">
                <tr>
                  {layout.visibleColumns.map((column) => (
                    <th key={column.id} aria-label={column.label} className="relative truncate border-b p-2">
                      {column.label}
                      <TableColumnResizeHandle column={column} onWidthChange={layout.setWidth} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {layout.visibleColumns.map((column) => (
                      <td
                        key={column.id}
                        className="max-w-80 truncate border-b p-2"
                        title={row[column.index]}
                      >
                        {row[column.index]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length === 0 && <p role="status" className="p-4 text-xs text-muted-foreground">No rows returned.</p>}
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
