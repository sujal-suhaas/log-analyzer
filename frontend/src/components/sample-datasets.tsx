import { useState } from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import type { ParserId } from "@/lib/parsers";

// The backend is optional and local-only. Nothing is fetched until the user asks
// for a sample, so opening the app stays completely network-free.
const API = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);

type Sample = {
  id: string;
  name: string;
  description: string;
  parser: ParserId;
  extension: string;
  records: number;
  download_url: string;
};

export function SampleDatasets({
  onLoad,
  disabled,
}: {
  onLoad: (file: File, parser: ParserId) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function catalogue() {
    setOpen(true);
    setError("");
    setSamples(null);
    try {
      const response = await fetch(`${API}/datasets`);
      if (!response.ok)
        throw new Error(`Backend returned ${response.status} ${response.statusText}.`);
      const body = (await response.json()) as { datasets?: Sample[] };
      if (!Array.isArray(body.datasets)) throw new Error("Unexpected response.");
      setSamples(body.datasets);
    } catch (cause) {
      setError(
        `Could not reach the local backend at ${API}. Start it with: uvicorn main:app --app-dir backend --port 8000. (${
          cause instanceof Error ? cause.message : "Request failed."
        })`,
      );
    }
  }

  async function load(sample: Sample) {
    setBusy(sample.id);
    setError("");
    try {
      const response = await fetch(`${API}${sample.download_url}`);
      if (!response.ok)
        throw new Error(`Backend returned ${response.status} ${response.statusText}.`);
      const blob = await response.blob();
      onLoad(
        new File([blob], `${sample.id}.${sample.extension}`, { type: blob.type }),
        sample.parser,
      );
      setOpen(false);
      setSamples(null);
    } catch (cause) {
      setError(
        `Could not download ${sample.name}. ${
          cause instanceof Error ? cause.message : "Request failed."
        }`,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-xl">
      {!open ? (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>No file handy?</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void catalogue()}
          >
            <Database size={13} />
            Load a sample dataset
          </Button>
        </div>
      ) : (
        <section
          aria-label="Sample datasets"
          className="rounded-lg border bg-card p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium">Sample datasets</p>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setOpen(false);
                setSamples(null);
                setError("");
              }}
            >
              Close
            </Button>
          </div>
          {samples === null && !error && (
            <p role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              Loading samples from {API}…
            </p>
          )}
          {samples && (
            <ul className="flex flex-col gap-1">
              {samples.map((sample) => (
                <li key={sample.id}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-auto w-full flex-col items-start gap-0.5 py-2 text-left"
                    disabled={disabled || busy !== null}
                    aria-label={`Load ${sample.name}`}
                    onClick={() => void load(sample)}
                  >
                    <span className="flex w-full items-center gap-2 text-xs">
                      {busy === sample.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Database size={12} />
                      )}
                      {sample.name}
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {sample.records.toLocaleString()} · {sample.parser}
                      </span>
                    </span>
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {sample.description}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <div role="alert" className="flex items-start gap-2 py-1 text-[10px] text-destructive">
              <span className="flex-1">{error}</span>
              <Button size="sm" variant="ghost" onClick={() => void catalogue()}>
                <RefreshCw size={12} />
                Retry
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
