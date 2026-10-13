# Browser Log Analytics Platform — Project Roadmap

> Build a CloudWatch Logs / Datadog-style log analyzer that does the heavy work **inside the browser**. Upload logs, parse them, store them locally, search/filter/query them, visualize them, and export results. The backend stays intentionally thin.
> 

# 1. What You're Building

The finished app should let a user:

- Upload or drag-drop log files.
- Parse common log formats into structured records.
- Search logs with plain text or regex.
- Filter by fields like level, service, host, status and time.
- Run SQL queries over the loaded logs.
- Browse large result sets without freezing the page.
- See charts such as log volume, errors, services and latency.
- Open a log event to inspect all its fields.
- Export filtered/query results as CSV or JSON.
- Keep datasets and saved queries locally in the browser.

The important idea is **the browser is the log-analysis engine**. Your server should not process every log line.

# 2. Recommended Stack

| Part | Use | Purpose |
| --- | --- | --- |
| Frontend | React + TypeScript + Vite | Main application |
| UI | Tailwind CSS + shadcn/ui | Dashboard-style interface |
| Query engine | DuckDB-WASM | Run SQL directly in the browser |
| Background work | Web Worker | Keep parsing and queries off the UI thread |
| Large tables | TanStack Virtual | Render only visible rows |
| Query editor | Monaco Editor | SQL editor, formatting and later autocomplete |
| Charts | Recharts | Simple analytics visualizations |
| Local app data | IndexedDB | Saved queries, history, dataset metadata |
| Large local data | OPFS later | Better persistence for larger datasets |
| Backend | FastAPI | Sample data, health/config and optional features |

**Do not add everything on day one.** Build the simple path first, then introduce DuckDB, Workers and persistence as the project becomes heavier.

# 3. Simple Architecture

```
File / Sample Dataset
        ↓
      React UI
        ↓
    Web Worker
        ↓
 Parser + DuckDB-WASM
        ↓
 Search / Filters / SQL
        ↓
Virtualized Table + Charts
        ↓
 CSV / JSON Export
```

The backend is separate:

```
FastAPI
  ├── health
  ├── sample datasets
  └── optional log generation / remote-file support
```

# 4. Build Plan

Use the checkboxes below as your actual project tracker. **Check a phase only after its milestone works.**

## Phase 1 — Basic UI + Raw Log Viewer

- [x]  **Phase 1 complete**

Start without DuckDB.

- [x]  Create the React/Vite project.
- [x]  Build the dashboard shell: sidebar, top bar, log table and detail panel.
- [x]  Add drag-and-drop/file picker.
- [x]  Read `.log`, `.txt`, `.json`, `.csv` files.
- [x]  Display raw lines in a virtualized table.
- [x]  Show file name, size, line count and loading progress.

**Milestone:** Open a large log file and scroll through it smoothly.

Do this first because virtualization and file handling are useful even before structured analysis exists.

## Phase 2 — Parsing

- [x]  **Phase 2 complete**

Create small parser modules:

- [x]  JSON Lines / NDJSON
- [x]  Apache/Nginx access logs
- [x]  Syslog-style logs
- [x]  Generic plain text

Normalize records into roughly:

```tsx
type LogRecord = {
  timestamp?: string;
  level?: string;
  service?: string;
  host?: string;
  status?: number;
  duration_ms?: number;
  message: string;
  raw: string;
  [key: string]: unknown;
};
```

- [x]  Add a parser selector rather than trying to automatically understand every possible log format.

**Milestone:** Upload a log file → get a structured table with useful columns.

## Phase 3 — Move Heavy Work Into a Web Worker

- [x]  **Phase 3 complete**
- [x]  Create one Worker responsible for expensive operations.

Keep the React side responsible for UI only. The Worker handles:

- [x]  parsing
- [x]  importing data
- [x]  running queries
- [x]  calculating statistics
- [x]  exporting large results

Use message types such as:

```
LOAD_FILE
PARSE_FILE
GET_SCHEMA
RUN_QUERY
GET_STATS
EXPORT_RESULT
CLEAR_DATASET
```

**Milestone:** large parsing/query operations no longer freeze the interface.

## Phase 4 — Add DuckDB-WASM

- [x]  **Phase 4 complete**

This is where the project becomes a real analytics tool.

- [x]  Load structured records into a DuckDB table called `logs`.
- [x]  Run `SELECT COUNT(*) FROM logs;`
- [x]  Run a query that sorts logs by timestamp and limits results.
- [x]  Run a `GROUP BY level` query.

Do **not** build your own query language yet. Let DuckDB handle the hard SQL work.

**Milestone:** the browser can query a large dataset instead of filtering everything with JavaScript arrays.

## Phase 5 — Search + Filters

- [x]  **Phase 5 complete**

Build the main log-explorer experience.

### Search

- [x]  Full-text search across message/raw fields.
- [x]  Regex search as an optional mode.
- [x]  Highlight matching text.

### Filters

- [x]  Level: ERROR / WARN / INFO / DEBUG
- [x]  Service
- [x]  Host
- [x]  Status code
- [x]  Duration
- [x]  Time range
- [x]  Translate UI filters into SQL `WHERE` conditions.

**Milestone:** combine several filters and instantly update the table.

## Phase 6 — Query Workspace

- [x]  **Phase 6 complete**
- [x]  Add a separate Query tab.
- [x]  Add a SQL editor with syntax highlighting and schema hints (CodeMirror).
- [x]  Run read-only queries through DuckDB.
- [x]  Add Run query.
- [x]  Add Clear.
- [x]  Add Format.
- [x]  Show query execution time.
- [x]  Show rows returned.
- [x]  Add query history.
- [x]  Add saved queries for the current session.

> Implementation note: CodeMirror is used instead of Monaco to keep the editor
> lightweight and lazy-loaded. Query text is passed to DuckDB unchanged, except
> for explicit user actions such as Format, selecting a saved query, or Clear.

Later:

- [ ]  Add a friendly query bar such as `level:ERROR service:auth status:500+` and convert it into SQL.

This gives you a CloudWatch/Datadog-like experience without building a complete query language.

## Phase 7 — Analytics

- [x]  **Phase 7 complete**

Add a small analytics dashboard.

- [x]  Logs over time
- [x]  Errors over time
- [x]  Logs by level
- [x]  Top services
- [x]  Top error messages
- [x]  Status-code distribution
- [x]  Average/p95 latency
- [x]  Click a chart → apply that condition to the log explorer.

> Implementation note: analytics are calculated in the existing DuckDB Worker
> for the active dataset and applied filters. Chart categories are bounded to
> keep the UI response small; chart clicks reuse the normal explorer filters.

That makes the analytics actually useful instead of just decorative charts.

## Phase 8 — Local Persistence

- [x]  **Phase 8 complete**

After the main analyzer works, add local persistence.

Use IndexedDB for:

- [x]  saved queries
- [x]  query history
- [x]  recent dataset metadata
- [x]  filter presets
- [x]  application settings

> Implementation note: IndexedDB stores the original local file Blob and
> metadata, query state, per-dataset active filters, named filter presets, and
> view/query settings. Reloading reconstructs the File and reparses it in the
> Worker; parsed records and DuckDB data remain process-local.

Later:

- [ ]  Investigate OPFS for keeping larger analytical data locally.

The goal is:

```
Upload once
   ↓
Reload browser
   ↓
Dataset still available
```

## Phase 9 — Export + Download

- [ ]  **Phase 9 complete**
- [ ]  Export filtered logs as CSV.
- [ ]  Export results as JSON/JSONL.
- [ ]  Download the original uploaded file.
- [ ]  Generate large exports from the Worker/database layer instead of normal React state.

## Phase 10 — Performance + Polish

- [ ]  **Phase 10 complete**
- [ ]  Loading/progress states.
- [ ]  Query cancellation.
- [ ]  Debounced search.
- [ ]  Empty/error states.
- [ ]  Column show/hide.
- [ ]  Resizable columns.
- [ ]  Dark mode.
- [ ]  Keyboard shortcuts.
- [ ]  Copy field/value buttons.
- [ ]  Log detail drawer with raw JSON.
- [ ]  Memory/large-file warning.
- [ ]  Test with 10K records.
- [ ]  Test with 100K records.
- [ ]  Test with 1M+ records.

# 5. Backend Scope

Keep FastAPI deliberately small.

```
GET  /health
GET  /datasets
GET  /datasets/{id}
GET  /datasets/{id}/download
POST /generate
```

The backend can provide demo datasets such as:

- API server logs
- authentication logs
- payment-service logs
- Nginx access logs
- distributed-service logs with correlated request IDs

The uploaded user logs should stay in the browser for the main version.

# 6. Dataset Formats

Support these in order:

**Start:**

- JSONL / NDJSON
- CSV
- plain `.log`

**Then:**

- Apache/Nginx
- Syslog
- custom regex parser

**Later:**

- `.gz`
- `.zip`
- Parquet

Do not start with compressed archives or advanced formats. They add complexity without improving the first version much.

# 7. Final Feature Priority

Use these as the final feature checklist after the core phases.

### Must Have

- [ ]  File upload
- [ ]  Raw + structured log viewer
- [ ]  Virtual scrolling
- [ ]  Parsing
- [ ]  Search
- [ ]  Field filters
- [ ]  Time filtering
- [ ]  DuckDB SQL queries
- [ ]  Log detail view
- [ ]  Basic charts
- [ ]  CSV/JSON export
- [ ]  Local saved queries

### Nice to Have

- [ ]  Custom regex parser
- [ ]  Query autocomplete
- [ ]  Click-to-filter charts
- [ ]  Query history
- [ ]  OPFS persistence
- [ ]  Multiple datasets

### Stretch Goals

- [ ]  Live tail mode
- [ ]  Join/correlate logs from multiple services
- [ ]  Request-ID tracing view
- [ ]  Remote log URL ingestion
- [ ]  Shareable saved searches
- [ ]  Simple CloudWatch/LogQL-style query syntax
- [ ]  Synthetic log generator

# 8. Suggested Learning Order

Track your learning alongside the project:

- [ ]  **1 — File API + streams**
- [ ]  **2 — Virtualized lists**
- [ ]  **3 — Web Workers**
- [ ]  **4 — Basic log parsing**
- [ ]  **5 — DuckDB-WASM**
- [ ]  **6 — SQL filtering/aggregation**
- [ ]  **7 — IndexedDB**
- [ ]  **8 — Charts**
- [ ]  **9 — Monaco query editor**
- [ ]  **10 — Performance optimization**

This keeps each stage understandable and gives you a working project after every major phase.

# 9. The Demo You Should Aim For

A good final demo should look like this:

```
Upload 500MB log file
        ↓
Browser parses it
        ↓
Dataset appears in explorer
        ↓
Search: "database timeout"
        ↓
Filter: ERROR + payment-api + last 1 hour
        ↓
Chart shows an error spike
        ↓
Click the spike
        ↓
Table narrows to that time window
        ↓
Open an event and inspect all fields
        ↓
Run SQL to find the top failing endpoints
        ↓
Export the filtered results
```

That single flow demonstrates the main point of the project: **serious log analysis without sending the logs to a heavy backend.**
