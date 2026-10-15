import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ROW_PAGE_SIZE, type useSegmentedRows } from "@/lib/use-segmented-rows";

export function SegmentedRowControls({
  rows,
  onNavigate,
}: {
  rows: ReturnType<typeof useSegmentedRows>;
  onNavigate: (row: number) => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  if (!rows.segmented) return null;
  return (
    <nav aria-label="Row pages" className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2 text-xs">
      <Button type="button" size="sm" variant="outline" disabled={rows.page === 0}
        onClick={() => onNavigate(rows.offset - ROW_PAGE_SIZE)}>
        Previous row page
      </Button>
      <span role="status" className="text-muted-foreground">
        Rows {(rows.offset + 1).toLocaleString()}–{(rows.offset + rows.count).toLocaleString()} of {rows.total.toLocaleString()}
        {" · "}Page {rows.page + 1} of {rows.pageCount}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={rows.page + 1 === rows.pageCount}
        onClick={() => onNavigate(rows.offset + ROW_PAGE_SIZE)}>
        Next row page
      </Button>
      <form className="flex items-center gap-2" onSubmit={(event) => {
        event.preventDefault();
        const row = Number(draft);
        if (Number.isInteger(row) && row >= 1 && row <= rows.total) onNavigate(row - 1);
      }}>
        <label htmlFor={inputId}>Jump to row</label>
        <input id={inputId} type="number" min={1} max={rows.total} step={1} required
          value={draft} onChange={(event) => setDraft(event.target.value)}
          className="w-28 rounded border bg-background p-1.5" />
        <Button type="submit" size="sm" variant="outline">Go to row</Button>
      </form>
    </nav>
  );
}

// Optional fields also support the parent's extended useWindow contract.
export function RowWindowStatus({ state, waiting }: {
  state: { error: string; loading?: boolean; retry?: () => void };
  waiting: boolean;
}) {
  if (state.error) return (
    <div role="alert" className="flex shrink-0 items-center gap-2 p-3 text-xs text-destructive">
      {state.error}
      {state.retry && <Button type="button" size="sm" variant="outline" onClick={state.retry}>Retry loading rows</Button>}
    </div>
  );
  if (state.loading ?? waiting) return (
    <p role="status" className="shrink-0 p-3 text-xs text-muted-foreground">Loading rows…</p>
  );
  return null;
}
