import { useCallback } from "react";
import { HighlightText } from "@/components/highlight";
import { TableColumnControls, TableColumnResizeHandle } from "@/components/table-column-controls";
import { Button } from "@/components/ui/button";
import { RowWindowStatus, SegmentedRowControls } from "@/components/segmented-row-controls";
import { useWindow } from "@/lib/use-window";
import { useSegmentedRows } from "@/lib/use-segmented-rows";
import { useTableColumns } from "@/lib/use-table-columns";
import { CORE_FIELDS, displayValue } from "@/lib/parsers/types";
import type { LogSummary } from "@/lib/worker/messages";
import type { LogWorkerClient } from "@/lib/worker/log-client";

export function StructuredTable({
  client,
  summary,
  filterId,
  total,
  selected,
  onSelect,
}: {
  client: LogWorkerClient;
  summary: LogSummary;
  filterId?: number;
  total: number | null;
  selected: number | null;
  onSelect: (row: number) => void;
}) {
  const viewTotal = total ?? summary.total;
  const rows = useSegmentedRows(viewTotal, 34, 8);
  const { scrollRef, range } = rows;
  const from = range[0]?.index ?? rows.offset;
  const to = range[range.length - 1]?.index ?? rows.offset - 1;
  const fetcher = useCallback(
    (start: number, count: number) =>
      client.records(summary.revision, start, count, filterId),
    [client, summary.revision, filterId],
  );
  const window = useWindow(fetcher, viewTotal, from, to);
  const { lookup } = window;
  const waiting = range.some((row) => !lookup(row.index));
  const active = Math.max(0, Math.min(selected ?? rows.offset, viewTotal - 1));
  function navigate(row: number) {
    rows.scrollToRow(row);
    onSelect(row);
  }
  const layout = useTableColumns([
    {
      id: "source-line", label: "LINE", field: null as string | null,
      defaultWidth: 80, minWidth: 64, maxWidth: 240, hideable: false,
    },
    ...[...CORE_FIELDS, ...summary.extras].map((field) => ({
      id: `field:${field}`, label: field, field,
      defaultWidth: field === "message" ? 360 : field === "timestamp" ? 220 : 160,
    })),
  ], "logline:structured-columns");
  const columns = layout.visibleColumns.filter(
    (column): column is typeof column & { field: string } => column.field !== null,
  );
  const template = layout.template;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TableColumnControls
        columns={layout.columns}
        onVisibilityChange={layout.setVisible}
        onWidthChange={layout.setWidth}
        onReset={layout.reset}
      />
      {!columns.length && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
          All log fields are hidden. Source lines and row details are still available.
          <Button type="button" size="sm" variant="outline" onClick={layout.reset}>
            Reset columns
          </Button>
        </div>
      )}
      <RowWindowStatus state={window} waiting={waiting} />
      <div
        ref={scrollRef}
        role="grid"
        aria-label="Structured logs"
        aria-rowcount={viewTotal + 1}
        aria-colcount={layout.visibleColumns.length}
        aria-busy={waiting && !window.error}
        tabIndex={0}
        aria-activedescendant={
          range.some((row) => row.index === active)
            ? `record-${active}`
            : undefined
        }
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-primary"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const next =
            event.key === "ArrowDown"
              ? Math.min(active + 1, viewTotal - 1)
              : event.key === "ArrowUp"
                ? Math.max(active - 1, 0)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? viewTotal - 1
                    : event.key === "Enter"
                      ? active
                      : null;
          if (next !== null && next >= 0 && next < viewTotal) {
            event.preventDefault();
            navigate(next);
          }
        }}
      >
        <div className="min-w-full" style={{ width: layout.totalWidth }}>
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 grid h-10 items-center border-b bg-background text-[10px] text-muted-foreground"
            style={{ gridTemplateColumns: template }}
          >
            {layout.visibleColumns.map((column) => (
              <div
                role="columnheader"
                aria-label={column.label}
                key={column.id}
                className={`flex h-full min-w-0 items-center ${column.field === null ? "sticky left-0 z-20 bg-background" : "relative"}`}
                title={column.label}
              >
                <span className="truncate px-3">{column.label}</span>
                <TableColumnResizeHandle column={column} onWidthChange={layout.setWidth} />
              </div>
            ))}
          </div>
          <div data-row-spacer style={{ height: rows.height, position: "relative" }}>
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
                  className={`absolute left-0 top-0 grid w-full cursor-pointer items-center border-b border-white/5 font-mono text-xs hover:bg-white/5 ${entry.failed ? "bg-red-400/5" : ""} ${item.index === selected ? "bg-primary/10" : ""}`}
                  style={{
                    gridTemplateColumns: template,
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <span
                    role="gridcell"
                    className="sticky left-0 z-10 truncate bg-background px-3 text-muted-foreground"
                  >
                    {entry.row + 1}
                    {filterId !== undefined && !entry.failed && (
                      <span
                        className="ml-1 text-primary"
                        title="Matches current filter"
                        aria-label="Filter match"
                      >
                        ●
                      </span>
                    )}
                    {entry.failed && (
                      <span
                        className="ml-1 text-destructive"
                        title={entry.failed}
                        aria-label={`Parse failed: ${entry.failed}`}
                      >
                        !
                      </span>
                    )}
                  </span>
                  {columns.map(({ field: key }) => (
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
                          className={`rounded px-1.5 py-0.5 ${/ERROR|FATAL|CRIT|EMERG|ALERT/.test(String(entry.record.level)) ? "bg-destructive/10 text-destructive" : entry.record.level === "WARN" ? "bg-amber-400/10 text-amber-800 dark:text-amber-300" : "bg-primary/10 text-primary"}`}
                        >
                          {String(entry.record.level)}
                        </span>
                      ) : key === "message" ? (
                        <HighlightText
                          text={displayValue(entry.record[key]).slice(0, 2000)}
                          ranges={entry.highlights}
                        />
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
        {!viewTotal && (
          <p className="p-6 text-sm text-muted-foreground">
            {filterId !== undefined
              ? "No matching records."
              : "No records. Blank lines and CSV headers are skipped."}
          </p>
        )}
      </div>
      <SegmentedRowControls rows={rows} onNavigate={navigate} />
      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        {summary.total.toLocaleString()} records ·{" "}
        {summary.failed.toLocaleString()} failed ·{" "}
        {summary.skipped.toLocaleString()} skipped
      </div>
    </div>
  );
}
