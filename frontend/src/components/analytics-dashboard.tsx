import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartFilterPatch, Filters } from "@/lib/filters";
import type { LogWorkerClient } from "@/lib/worker/log-client";
import { Button } from "./ui/button";
import type {
  AnalyticsCountPoint,
  AnalyticsMessagePoint,
  AnalyticsSnapshot,
  AnalyticsStatusPoint,
  AnalyticsTimePoint,
  LogSummary,
} from "@/lib/worker/messages";

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatBucket(value: number) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLatency(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}

function EmptyChart({ message = "No data available." }: { message?: string }) {
  return (
    <p role="status" className="flex min-h-24 items-center justify-center text-xs text-muted-foreground">
      {message}
    </p>
  );
}

function TimeChart({
  title,
  points,
  metric,
  onApplyFilter,
}: {
  title: string;
  points: AnalyticsTimePoint[];
  metric: "logs" | "errors";
  onApplyFilter: (patch: ChartFilterPatch) => void;
}) {
  const data = points.map((point) => ({
    ...point,
    label: formatBucket(point.startMs),
  }));
  return (
    <section aria-label={title} className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium">{title}</h2>
        <span className="text-[10px] text-muted-foreground">
          Click a point to filter
        </span>
      </div>
      {points.length === 0 ? (
        <EmptyChart message="No timestamped records in this scope." />
      ) : (
        <>
          <div
            role="img"
            aria-label={`${title} chart`}
            className="h-48 w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)" }} />
                <Line
                  type="monotone"
                  dataKey={metric}
                  stroke={metric === "errors" ? "var(--destructive)" : "var(--primary)"}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {points.map((point) => (
              <button
                key={point.startMs}
                type="button"
                className="rounded border px-2 py-1 text-left text-[10px] hover:bg-muted"
                aria-label={`${formatBucket(point.startMs)}, ${point[metric]} ${metric}`}
                onClick={() =>
                  onApplyFilter({
                    kind: "time",
                    startMs: point.startMs,
                    endMs: point.endMs,
                  })
                }
              >
                {formatBucket(point.startMs)} · {point[metric]}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CountChart({
  title,
  points,
  hasMore,
  onApplyFilter,
}: {
  title: string;
  points: AnalyticsCountPoint[];
  hasMore?: boolean;
  onApplyFilter: (patch: ChartFilterPatch) => void;
}) {
  const max = Math.max(1, ...points.map((point) => point.count));
  return (
    <section aria-label={title} className="rounded-lg border p-3">
      <h2 className="mb-2 text-xs font-medium">{title}</h2>
      {points.length === 0 ? (
        <EmptyChart />
      ) : (
        <div className="grid gap-1">
          {points.map((point) => {
            const label = point.value ?? "Unknown";
            const content = (
              <>
                <span className="relative z-10 truncate">{label}</span>
                <span className="relative z-10 shrink-0">
                  {formatCount(point.count)}
                </span>
                <span
                  className="absolute inset-y-0 left-0 rounded bg-primary/15"
                  style={{ width: `${Math.max(8, (point.count / max) * 100)}%` }}
                />
              </>
            );
            return point.value === null ? (
              <div
                key="unknown"
                className="relative flex min-h-7 items-center justify-between gap-2 rounded px-2 py-1 text-[10px] text-muted-foreground"
              >
                {content}
              </div>
            ) : (
              <button
                key={point.value}
                type="button"
                className="relative flex min-h-7 items-center justify-between gap-2 rounded px-2 py-1 text-left text-[10px] hover:bg-muted"
                aria-label={`${label}, ${formatCount(point.count)} logs`}
                onClick={() =>
                  onApplyFilter({ kind: title === "Logs by level" ? "level" : "service", value: point.value! })
                }
              >
                {content}
              </button>
            );
          })}
          {hasMore && (
            <p className="pt-1 text-[10px] text-muted-foreground">Showing top 10.</p>
          )}
        </div>
      )}
    </section>
  );
}

function StatusChart({
  points,
  onApplyFilter,
}: {
  points: AnalyticsStatusPoint[];
  onApplyFilter: (patch: ChartFilterPatch) => void;
}) {
  const max = Math.max(1, ...points.map((point) => point.count));
  return (
    <section aria-label="Status-code distribution" className="rounded-lg border p-3">
      <h2 className="mb-2 text-xs font-medium">Status-code distribution</h2>
      {points.length === 0 ? (
        <EmptyChart />
      ) : (
        <div className="grid gap-1">
          {points.map((point) => {
            const label = point.status === null ? "Unknown" : String(point.status);
            const content = (
              <>
                <span className="relative z-10">{label}</span>
                <span className="relative z-10">{formatCount(point.count)}</span>
                <span
                  className="absolute inset-y-0 left-0 rounded bg-chart-3/30"
                  style={{ width: `${Math.max(8, (point.count / max) * 100)}%` }}
                />
              </>
            );
            return point.status === null ? (
              <div
                key="unknown"
                className="relative flex min-h-7 items-center justify-between rounded px-2 py-1 text-[10px] text-muted-foreground"
              >
                {content}
              </div>
            ) : (
              <button
                key={point.status}
                type="button"
                className="relative flex min-h-7 items-center justify-between rounded px-2 py-1 text-left text-[10px] hover:bg-muted"
                aria-label={`${label}, ${formatCount(point.count)} logs`}
                onClick={() => onApplyFilter({ kind: "status", value: point.status! })}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MessageChart({
  points,
  hasMore,
  onApplyFilter,
}: {
  points: AnalyticsMessagePoint[];
  hasMore: boolean;
  onApplyFilter: (patch: ChartFilterPatch) => void;
}) {
  const max = Math.max(1, ...points.map((point) => point.count));
  return (
    <section aria-label="Top error messages" className="rounded-lg border p-3">
      <h2 className="mb-2 text-xs font-medium">Top error messages</h2>
      {points.length === 0 ? (
        <EmptyChart message="No error messages in this scope." />
      ) : (
        <div className="grid gap-1">
          {points.map((point) => (
            <button
              key={`${point.filterText}-${point.count}`}
              type="button"
              className="relative flex min-h-7 items-center justify-between gap-2 overflow-hidden rounded px-2 py-1 text-left text-[10px] hover:bg-muted"
              title={point.truncated ? `${point.filterText}…` : point.filterText}
              aria-label={`Error message ${point.label}, ${formatCount(point.count)} logs`}
              onClick={() =>
                onApplyFilter({ kind: "error-message", filterText: point.filterText })
              }
            >
              <span className="relative z-10 truncate">{point.label}</span>
              <span className="relative z-10 shrink-0">{formatCount(point.count)}</span>
              <span
                className="absolute inset-y-0 left-0 rounded bg-destructive/20"
                style={{ width: `${Math.max(8, (point.count / max) * 100)}%` }}
              />
            </button>
          ))}
          {hasMore && (
            <p className="pt-1 text-[10px] text-muted-foreground">Showing top 10.</p>
          )}
        </div>
      )}
    </section>
  );
}

export default function AnalyticsDashboard({
  client,
  summary,
  filters,
  onApplyFilter,
}: {
  client: LogWorkerClient;
  summary: LogSummary;
  filters: Filters;
  onApplyFilter: (patch: ChartFilterPatch) => void;
}) {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    void client
      .analytics(summary.revision, filters)
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((cause) => {
        if (active) {
          setSnapshot(null);
          setError(cause instanceof Error ? cause.message : "Analytics failed.");
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [client, summary.revision, filters, attempt]);

  return (
    <div
      role="region"
      aria-label="Analytics dashboard"
      className="min-h-0 flex-1 overflow-auto p-4"
    >
      {busy && (
        <p role="status" className="mb-3 text-xs text-muted-foreground">
          Calculating analytics in the Worker…
        </p>
      )}
      {error && (
        <div role="alert" aria-label="Analytics query error" className="mb-3 rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
          <Button size="sm" variant="outline" className="ml-2" onClick={() => setAttempt((value) => value + 1)}>Retry analytics</Button>
        </div>
      )}
      {snapshot && (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            {[
              ["Records", snapshot.scope.totalLogs],
              ["Errors", snapshot.scope.errorLogs],
              ["Timestamped", snapshot.scope.timestampedLogs],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-card p-3">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-medium">{formatCount(Number(value))}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <TimeChart
              title="Logs over time"
              points={snapshot.time.points}
              metric="logs"
              onApplyFilter={onApplyFilter}
            />
            <TimeChart
              title="Errors over time"
              points={snapshot.time.points}
              metric="errors"
              onApplyFilter={onApplyFilter}
            />
            <CountChart
              title="Logs by level"
              points={snapshot.levels}
              onApplyFilter={onApplyFilter}
            />
            <CountChart
              title="Top services"
              points={snapshot.services.points}
              hasMore={snapshot.services.hasMore}
              onApplyFilter={onApplyFilter}
            />
            <MessageChart
              points={snapshot.errorMessages.points}
              hasMore={snapshot.errorMessages.hasMore}
              onApplyFilter={onApplyFilter}
            />
            <StatusChart points={snapshot.statusCodes} onApplyFilter={onApplyFilter} />
            <section aria-label="Latency" className="rounded-lg border p-3">
              <h2 className="mb-2 text-xs font-medium">Latency</h2>
              {snapshot.latency.sampleCount === 0 ? (
                <EmptyChart message="No duration_ms values in this scope." />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Average</p>
                    <p className="mt-1 text-lg font-medium">
                      {formatLatency(snapshot.latency.averageMs)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">P95</p>
                    <p className="mt-1 text-lg font-medium">
                      {formatLatency(snapshot.latency.p95Ms)}
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {!busy && !error && snapshot?.scope.totalLogs === 0 && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          No records match the current scope.
        </p>
      )}
    </div>
  );
}
