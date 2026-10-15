import { useCallback } from "react";
import { HighlightText } from "@/components/highlight";
import { RowWindowStatus, SegmentedRowControls } from "@/components/segmented-row-controls";
import { useWindow } from "@/lib/use-window";
import { useSegmentedRows } from "@/lib/use-segmented-rows";
import type { LogWorkerClient } from "@/lib/worker/log-client";

export function LogTable({
  client,
  revision,
  lineCount,
  filterId,
  selected,
  onSelect,
}: {
  client: LogWorkerClient;
  revision: number;
  lineCount: number;
  filterId?: number;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const rows = useSegmentedRows(lineCount, 32, 10);
  const { scrollRef, range } = rows;
  const from = range[0]?.index ?? rows.offset;
  const to = range[range.length - 1]?.index ?? rows.offset - 1;
  const fetcher = useCallback(
    (start: number, count: number) =>
      client.rawRows(revision, start, count, filterId),
    [client, revision, filterId],
  );
  const window = useWindow(fetcher, lineCount, from, to);
  const { lookup } = window;
  const waiting = range.some((row) => !lookup(row.index));
  const active = Math.max(0, Math.min(selected ?? rows.offset, lineCount - 1));
  function navigate(row: number) {
    rows.scrollToRow(row);
    onSelect(row);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RowWindowStatus state={window} waiting={waiting} />
      <div className="flex h-10 shrink-0 items-center border-b bg-white/[.015] font-mono text-[10px] tracking-wider text-muted-foreground">
        <span className="w-20 shrink-0 text-center">LINE</span>
        <span>RAW CONTENT</span>
        <span className="ml-auto pr-4 font-sans tracking-normal">UTF-8</span>
      </div>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Raw log lines"
        aria-busy={waiting && !window.error}
        aria-activedescendant={
          range.some((row) => row.index === active)
            ? `log-line-${active}`
            : undefined
        }
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const next =
            e.key === "ArrowDown"
              ? Math.min(active + 1, lineCount - 1)
              : e.key === "ArrowUp"
                ? Math.max(active - 1, 0)
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? lineCount - 1
                    : null;
          if (next !== null && next >= 0 && next < lineCount) {
            e.preventDefault();
            navigate(next);
          }
          if (e.key === "Enter" && lineCount) {
            e.preventDefault();
            onSelect(active);
          }
        }}
      >
        <div
          data-row-spacer
          style={{
            height: rows.height,
            position: "relative",
            minWidth: "100%",
          }}
        >
          {range.map((row) => {
            const entry = lookup(row.index);
            const raw = entry?.raw ?? "";
            return (
              <div
                id={`log-line-${row.index}`}
                key={row.key}
                role="option"
                aria-posinset={row.index + 1}
                aria-setsize={lineCount}
                aria-selected={selected === row.index}
                onClick={() => onSelect(row.index)}
                className={`absolute left-0 top-0 flex w-max min-w-full cursor-pointer items-center border-b border-border/60 font-mono text-xs hover:bg-muted/40 ${selected === row.index ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                style={{
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <span className="sticky left-0 w-20 shrink-0 bg-background/95 pr-5 text-right text-[10px] text-muted-foreground">
                  {((entry?.row ?? row.index) + 1).toLocaleString()}
                </span>
                {/* ponytail: preview capped at 2K chars; full line remains in detail panel. */}
                <span className="whitespace-pre pr-8">
                  <HighlightText
                    text={entry ? raw.slice(0, 2000) || " " : "Loading…"}
                    ranges={entry?.highlights}
                  />
                  {raw.length > 2000 ? " … [open full line]" : ""}
                </span>
              </div>
            );
          })}
        </div>
        {lineCount === 0 && <p role="status" className="p-6 text-sm text-muted-foreground">{filterId === undefined ? "This file has no log lines." : "No matching lines."}</p>}
      </div>
      <SegmentedRowControls rows={rows} onNavigate={navigate} />
      <div className="flex h-9 shrink-0 items-center justify-between border-t px-4 text-[11px] text-muted-foreground">
        <span>{lineCount.toLocaleString()} lines · Virtual scrolling</span>
        <span>↑ ↓ navigate · Enter inspect</span>
      </div>
    </div>
  );
}
