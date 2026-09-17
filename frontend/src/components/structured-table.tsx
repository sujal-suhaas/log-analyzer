import { useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWindow } from "@/lib/use-window";
import { CORE_FIELDS, displayValue } from "@/lib/parsers/types";
import type { LogSummary } from "@/lib/worker/messages";
import type { LogWorkerClient } from "@/lib/worker/log-client";

export function StructuredTable({
  client,
  summary,
  selected,
  onSelect,
}: {
  client: LogWorkerClient;
  summary: LogSummary;
  selected: number | null;
  onSelect: (row: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: summary.total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 8,
  });
  const range = virtual.getVirtualItems();
  const from = range[0]?.index ?? 0;
  const to = range[range.length - 1]?.index ?? -1;
  const fetcher = useCallback(
    (start: number, count: number) =>
      client.records(summary.revision, start, count),
    [client, summary.revision],
  );
  const { lookup, error } = useWindow(fetcher, summary.total, from, to);
  const active = Math.max(0, selected ?? 0);
  const columns = [...CORE_FIELDS, ...summary.extras];
  const template = `80px ${columns.map((key) => (key === "message" ? "360px" : key === "timestamp" ? "220px" : "160px")).join(" ")}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p role="alert" className="p-3 text-xs text-red-300">
          {error}
        </p>
      )}
      <div
        ref={scrollRef}
        role="grid"
        aria-label="Structured logs"
        aria-rowcount={summary.total + 1}
        aria-colcount={columns.length + 1}
        tabIndex={0}
        aria-activedescendant={
          range.some((row) => row.index === active)
            ? `record-${active}`
            : undefined
        }
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-primary"
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowDown"
              ? Math.min(active + 1, summary.total - 1)
              : event.key === "ArrowUp"
                ? Math.max(active - 1, 0)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? summary.total - 1
                    : event.key === "Enter"
                      ? active
                      : null;
          if (next !== null && next >= 0 && next < summary.total) {
            event.preventDefault();
            virtual.scrollToIndex(next);
            onSelect(next);
          }
        }}
      >
        <div className="w-max min-w-full">
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 grid h-10 items-center border-b bg-background text-[10px] text-muted-foreground"
            style={{ gridTemplateColumns: template }}
          >
            <span role="columnheader" className="px-3">
              LINE
            </span>
            {columns.map((key) => (
              <span
                role="columnheader"
                key={key}
                className="truncate px-3"
                title={key}
              >
                {key}
              </span>
            ))}
          </div>
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {range.map((item) => {
              const entry = lookup(item.index);
              return entry ? (
                <div
                  id={`record-${item.index}`}
                  key={item.key}
                  role="row"
                  aria-rowindex={item.index + 2}
                  aria-selected={item.index === selected}
                  onClick={() => onSelect(item.index)}
                  className={`absolute left-0 top-0 grid cursor-pointer items-center border-b border-white/5 font-mono text-xs hover:bg-white/5 ${entry.failed ? "bg-red-400/5" : ""} ${item.index === selected ? "bg-primary/10" : ""}`}
                  style={{
                    gridTemplateColumns: template,
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <span
                    role="gridcell"
                    className="sticky left-0 bg-background px-3 text-muted-foreground"
                  >
                    {entry.row + 1}
                    {entry.failed && (
                      <span
                        className="ml-1 text-red-300"
                        title={entry.failed}
                        aria-label={`Parse failed: ${entry.failed}`}
                      >
                        !
                      </span>
                    )}
                  </span>
                  {columns.map((key) => (
                    <span
                      role="gridcell"
                      key={key}
                      className="truncate px-3"
                      title={
                        key === "message" && entry.failed
                          ? entry.failed
                          : undefined
                      }
                    >
                      {key === "level" && entry.record.level ? (
                        <span
                          className={`rounded px-1.5 py-0.5 ${/ERROR|FATAL|CRIT|EMERG|ALERT/.test(String(entry.record.level)) ? "bg-red-400/10 text-red-300" : entry.record.level === "WARN" ? "bg-amber-400/10 text-amber-300" : "bg-primary/10 text-primary"}`}
                        >
                          {String(entry.record.level)}
                        </span>
                      ) : (
                        displayValue(entry.record[key]).slice(0, 2000) || "—"
                      )}
                    </span>
                  ))}
                </div>
              ) : null;
            })}
          </div>
        </div>
        {!summary.total && (
          <p className="p-6 text-sm text-muted-foreground">
            No records. Blank lines and CSV headers are skipped.
          </p>
        )}
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        {summary.total.toLocaleString()} records ·{" "}
        {summary.failed.toLocaleString()} failed ·{" "}
        {summary.skipped.toLocaleString()} skipped
      </div>
    </div>
  );
}
