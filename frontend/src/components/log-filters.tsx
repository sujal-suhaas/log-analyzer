import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EMPTY_FILTERS,
  filterWhere,
  type Filters,
  type FilterSummary,
} from "@/lib/filters";
import type { LogWorkerClient } from "@/lib/worker/log-client";

export function LogFilters({
  client,
  revision,
  disabled,
  hasTime,
  onChange,
}: {
  client: LogWorkerClient;
  revision: number;
  disabled: boolean;
  hasTime: boolean;
  onChange: (result: FilterSummary | null) => void;
}) {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  // Hold the latest callback in a ref: parent re-renders must not restart the debounce
  // (an inline onChange prop changes identity every render and would re-query forever).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (disabled) return;
    const id = ++generation.current;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        setError("");
        if (!filterWhere(draft).active) {
          setBusy(false);
          onChangeRef.current(null);
          return;
        }
        setBusy(true);
        const result = await client.filter(revision, draft);
        if (active && generation.current === id) onChangeRef.current(result);
      } catch (cause) {
        if (active && generation.current === id)
          setError(cause instanceof Error ? cause.message : "Filter failed.");
      } finally {
        if (active && generation.current === id) setBusy(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, revision, disabled, draft]);
  const field = (key: keyof Filters, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const inputClass = "min-w-0 rounded border bg-background px-2 py-1.5 text-xs";
  return (
    <fieldset
      disabled={disabled}
      aria-label="Search and filters"
      className="mx-4 mb-3 shrink-0 space-y-2 sm:mx-7"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search logs"
          placeholder="Search message or raw text…"
          maxLength={1000}
          value={draft.text}
          onChange={(e) => field("text", e.target.value)}
          className={`${inputClass} w-60 flex-1`}
        />
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            aria-label="Regex search"
            checked={draft.regex}
            onChange={(e) => field("regex", e.target.checked)}
          />
          Regex (RE2)
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            generation.current++;
            setDraft({ ...EMPTY_FILTERS });
            setBusy(false);
            setError("");
            onChangeRef.current(null);
          }}
        >
          Clear filters
        </Button>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {busy ? "Filtering…" : "Case-insensitive search"}
        </span>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          More filters
        </summary>
        <div className="mt-2 grid max-h-40 grid-cols-2 gap-2 overflow-auto sm:grid-cols-4">
          {(["level", "service", "host"] as const).map((key) => (
            <label key={key} className="grid gap-1 text-xs">
              {key}
              <input
                aria-label={`Filter ${key}`}
                maxLength={1000}
                value={draft[key]}
                onChange={(e) => field(key, e.target.value)}
                className={inputClass}
                placeholder="Exact value"
              />
            </label>
          ))}
          {(
            [
              ["statusMin", "Minimum status", 100, 599],
              ["statusMax", "Maximum status", 100, 599],
              ["durationMin", "Minimum duration (ms)", 0, undefined],
              ["durationMax", "Maximum duration (ms)", 0, undefined],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key} className="grid gap-1 text-xs">
              {label}
              <input
                type="number"
                step={key.startsWith("status") ? 1 : "any"}
                min={min}
                max={max}
                aria-label={label}
                value={draft[key]}
                onChange={(e) => field(key, e.target.value)}
                className={inputClass}
              />
            </label>
          ))}
          <label className="grid gap-1 text-xs">
            Time range
            <select
              aria-label="Time range"
              disabled={!hasTime}
              value={draft.time}
              onChange={(e) => field("time", e.target.value)}
              className={inputClass}
            >
              <option value="all">All time</option>
              <option value="1h">Last 1h (dataset)</option>
              <option value="24h">Last 24h (dataset)</option>
              <option value="7d">Last 7d (dataset)</option>
              <option value="custom">Custom (local time)</option>
            </select>
          </label>
          {draft.time === "custom" &&
            (["from", "to"] as const).map((key) => (
              <label key={key} className="grid gap-1 text-xs">
                {key}
                <input
                  type="datetime-local"
                  step="1"
                  aria-label={`Time ${key}`}
                  className={inputClass}
                  onChange={(e) => {
                    const value = e.target.value;
                    field(key, value ? new Date(value).toISOString() : "");
                  }}
                />
              </label>
            ))}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Ranges inclusive. Unknown timestamps excluded by time filters. Presets
          use newest dataset timestamp. Regex: RE2, no
          lookaround/backreferences. Highlights: first 2K characters.
        </p>
      </details>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error} Previous results kept.
        </p>
      )}
    </fieldset>
  );
}
