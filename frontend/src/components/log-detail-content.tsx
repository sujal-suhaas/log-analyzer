import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "./ui/button";
import { HighlightText } from "./highlight";
import type { LogDetail } from "@/lib/worker/messages";

const DETAIL_PREVIEW = 16_000;
const textValue = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) ?? String(value);

export function LogDetailContent({ detail, error, onRetry }: {
  detail: LogDetail | null;
  error: string;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setCopyError("");
    } catch {
      setCopyError("Clipboard unavailable. Select and copy the text manually.");
    }
  }
  const preview = (text: string) => expanded ? text : text.slice(0, DETAIL_PREVIEW);
  const record = detail?.entry?.record;
  const parsed = record ? JSON.stringify(record, null, 2) : "";
  const oversized = !!detail && (detail.raw.length > DETAIL_PREVIEW || parsed.length > DETAIL_PREVIEW);
  return (
    <>
      {error && (
        <div role="alert" className="mb-3 space-y-2 text-xs text-destructive">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>Retry details</Button>
        </div>
      )}
      {!detail && !error && <p role="status" className="text-xs text-muted-foreground">Loading details…</p>}
      {detail?.entry?.failed && <p className="mb-4 rounded border border-destructive/30 p-2 text-xs text-destructive">Parse failed: {detail.entry.failed}</p>}
      {oversized && (
        <div role="note" aria-label="Large record warning" className="mb-3 text-xs text-muted-foreground">
          Large record: showing the first 16,000 characters per value. Copy and downloads always retain the full value.
          <Button size="sm" variant="outline" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse large record" : "Show full record"}
          </Button>
        </div>
      )}
      {record && (
        <>
          <dl aria-label="Parsed fields" className="mb-5 space-y-3 text-xs">
            {Object.entries(record).map(([key, value]) => (
              <div key={key}>
                <dt className="flex flex-wrap items-center gap-1 text-muted-foreground">
                  <span>{key}</span>
                  <Button size="icon-xs" variant="ghost" aria-label={`Copy field ${key}`} onClick={() => void copy(key, `Field ${key}`)}><Copy size={12} /></Button>
                  <Button size="icon-xs" variant="ghost" aria-label={`Copy value ${key}`} onClick={() => void copy(textValue(value), `Value ${key}`)}><Copy size={12} /></Button>
                </dt>
                <dd className="mt-1 whitespace-pre-wrap break-all font-mono">{preview(textValue(value)) || '""'}</dd>
              </div>
            ))}
          </dl>
          <div className="mb-3 space-y-2">
            <Button size="sm" variant="outline" aria-expanded={jsonOpen} onClick={() => setJsonOpen(!jsonOpen)}>Parsed JSON</Button>
            <Button size="sm" variant="ghost" onClick={() => void copy(parsed, "Parsed JSON")}>Copy parsed JSON</Button>
            {jsonOpen && <pre aria-label="Parsed JSON" className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 font-mono text-xs">{preview(parsed)}</pre>}
          </div>
        </>
      )}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] tracking-wider text-muted-foreground">RAW CONTENT</span>
        <Button variant="ghost" size="sm" disabled={!detail} onClick={() => detail && void copy(detail.raw, "Raw content")}>
          <Copy size={12} /> {copied === "Raw content" ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre aria-label="Raw log content" className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 font-mono text-xs leading-6 text-foreground">
        {detail ? detail.raw ? <HighlightText text={preview(detail.raw)} ranges={detail.highlights} /> : "(empty line)" : error ? "Details unavailable." : "Loading…"}
      </pre>
      {copied && <p role="status" className="mt-2 text-xs text-muted-foreground">{copied} copied.</p>}
      {copyError && <p role="alert" className="mt-2 text-xs text-destructive">{copyError}</p>}
    </>
  );
}
