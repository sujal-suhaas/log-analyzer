import { useLayoutEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "./ui/button";
import { downloadBlob } from "@/lib/download";
import type { ExportFormat, ExportResult } from "@/lib/worker/log-client";

export function ExportControls({
  kind,
  disabled,
  onExport,
}: {
  kind: "logs" | "query";
  disabled: boolean;
  onExport: (format: ExportFormat) => Promise<ExportResult>;
}) {
  const [format, setFormat] = useState<ExportFormat>(kind === "logs" ? "csv" : "json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lifecycle = useRef({ generation: 0 });
  const inFlight = useRef(false);
  // A change of scope remounts this component. Imports, edits, and unmounts
  // must also suppress a late download, not just a late status update.
  useLayoutEffect(() => {
    const state = lifecycle.current;
    state.generation++;
    return () => { state.generation++; };
  }, [disabled]);

  async function start() {
    if (disabled || inFlight.current) return;
    const state = lifecycle.current;
    const id = ++state.generation;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await onExport(format);
      if (id !== state.generation) return;
      downloadBlob(result.blob, result.filename);
      setNotice(`Downloaded ${result.rowCount.toLocaleString()} rows.`);
    } catch (cause) {
      if (id === state.generation)
        setError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={kind === "logs" ? "Filtered log export" : "Query result export"}
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs"
    >
      <select
        aria-label={kind === "logs" ? "Filtered export format" : "Query export format"}
        className="rounded border bg-background px-2 py-1 text-xs"
        value={format}
        disabled={disabled || busy}
        onChange={(event) => setFormat(event.target.value as ExportFormat)}
      >
        <option value="csv">CSV</option>
        <option value="json">JSON</option>
        <option value="jsonl">JSONL</option>
      </select>
      <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => void start()}>
        <Download size={13} />
        {kind === "logs" ? "Export filtered logs" : "Export query results"}
      </Button>
      {busy && <span role="status">Generating export in Worker…</span>}
      {!busy && notice && <span role="status">{notice}</span>}
      {error && <span role="alert" className="text-destructive">{error}</span>}
      {format === "csv" && (
        <span className="text-[10px] text-muted-foreground">
          CSV preserves cell text. Import untrusted logs as text in spreadsheets.
        </span>
      )}
    </div>
  );
}
