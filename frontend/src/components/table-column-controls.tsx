import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TableColumnLayout } from "@/lib/use-table-columns";

type WidthChange = (id: string, width: number) => void;

function ColumnWidthInput({
  column,
  onWidthChange,
}: {
  column: TableColumnLayout;
  onWidthChange: WidthChange;
}) {
  // Let users finish typing before clamping (typing "400" starts with "4").
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && Number.isFinite(Number(draft)))
      onWidthChange(column.id, Number(draft));
    setDraft(null);
  };
  return (
    <label className="flex shrink-0 items-center gap-1 text-muted-foreground">
      <span className="sr-only">Width of {column.label}</span>
      <input
        type="number"
        aria-label={`Width of ${column.label} (px)`}
        min={column.minWidth}
        max={column.maxWidth}
        step={1}
        value={draft ?? column.width}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape" && draft !== null) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
          }
        }}
        className="w-20 rounded border bg-background px-2 py-1 text-xs text-foreground"
      />
      px
    </label>
  );
}

export function TableColumnControls({
  columns,
  onVisibilityChange,
  onWidthChange,
  onReset,
}: {
  columns: readonly TableColumnLayout[];
  onVisibilityChange: (id: string, visible: boolean) => void;
  onWidthChange: WidthChange;
  onReset: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  return (
    <details
      ref={detailsRef}
      className="shrink-0 border-b px-4 py-2 text-xs"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (detailsRef.current) detailsRef.current.open = false;
        summaryRef.current?.focus();
      }}
    >
      <summary ref={summaryRef} className="w-fit cursor-pointer rounded focus-visible:outline-primary">
        Columns ({columns.filter((column) => column.visible).length}/{columns.length})
      </summary>
      <fieldset className="mt-2 min-w-0">
        <legend className="sr-only">Column visibility and widths</legend>
        <p className="mb-2 text-muted-foreground">
          Choose visible columns and widths. Drag header edges or use Left/Right arrows on a resize
          handle. Numeric widths apply on Enter or leaving the input.
        </p>
        <div className="grid max-h-48 gap-x-6 gap-y-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
          {columns.map((column) => (
            <div key={column.id} className="flex min-w-0 items-center justify-between gap-2">
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Show ${column.label} column`}
                  checked={column.visible}
                  disabled={column.hideable === false}
                  onChange={(event) => onVisibilityChange(column.id, event.target.checked)}
                />
                <span className="truncate" title={column.label}>
                  {column.label}{column.hideable === false ? " (always visible)" : ""}
                </span>
              </label>
              <ColumnWidthInput column={column} onWidthChange={onWidthChange} />
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onReset}>
          Reset columns
        </Button>
      </fieldset>
    </details>
  );
}

export function TableColumnResizeHandle({
  column,
  onWidthChange,
}: {
  column: TableColumnLayout;
  onWidthChange: WidthChange;
}) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  return (
    <span
      role="separator"
      aria-label={`Resize ${column.label} column`}
      aria-orientation="vertical"
      aria-valuemin={column.minWidth}
      aria-valuemax={column.maxWidth}
      aria-valuenow={column.width}
      aria-valuetext={`${column.width} pixels`}
      tabIndex={0}
      title="Drag to resize. Left/Right: 10px; Shift: 50px; Home/End: minimum/maximum."
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none border-r border-border hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline focus-visible:outline-primary"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width: column.width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        onWidthChange(column.id, start.width + event.clientX - start.x);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 10;
        const width = event.key === "ArrowLeft" ? column.width - step
          : event.key === "ArrowRight" ? column.width + step
          : event.key === "Home" ? column.minWidth
          : event.key === "End" ? column.maxWidth : null;
        if (width === null) return;
        event.preventDefault();
        event.stopPropagation();
        onWidthChange(column.id, width);
      }}
    />
  );
}
