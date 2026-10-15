# Logline — Phase 10

Browser-based raw and structured log explorer. Phases 1–10 of the [roadmap](https://app.notion.com/p/Browser-Log-Analytics-Platform-Project-Roadmap-3dc528b4136d81579631e6fb72e6cbbe): local file import, virtual scrolling, Worker-owned parsing, DuckDB-WASM SQL, search + filters, a query workspace, analytics, IndexedDB persistence, local exports/downloads, and performance/usability polish. Uploaded logs never go to the backend.

## Run

Frontend (Bun):

```bash
cd frontend
bun install
bun dev          # http://localhost:5173
```

Backend (FastAPI, health endpoint only):

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt   # POSIX: backend/.venv/bin/pip
backend/.venv/Scripts/python -m uvicorn main:app --app-dir backend --port 8000
```

## Verify

```bash
cd frontend
bun test tests              # reader limits/edge cases, parsers, filters, export serialization
bun run build               # type check + production build
bun run lint                # oxlint (warnings remain; no errors)
bunx playwright test        # full browser suite, including the successful 1.1M-record workload
```

Latest verification: **39 unit tests and 44 Chromium browser tests passed**; typecheck/production build passed; lint reported nine warnings and no errors. Browser tests start the production app on `127.0.0.1:4173` and FastAPI on port `8000`; native Worker cancellation tests also start Vite on port `4174`. Keep those ports available. Firefox/WebKit are not verified by this suite.

## Scope & limits (Phase 10)

- UTF-8 text, max **50 MiB (52,428,800 bytes)** and **1,250,000 physical source lines** per file, `.log .txt .json .csv .jsonl .ndjson`. Blank lines and CSV headers count toward the source-line limit even though they are excluded from structured records. A trailing newline does not create an extra empty line. Incoming files are preflighted for extension/size before workspace changes; line-limit/read/parse failures preserve the active dataset.
- Select parser before importing, or change it afterward to re-parse the current file. No format auto-detection.
- **Workspace**: import as many files as you like; each stays listed with its own parser and line count. Only the active file is parsed in the Worker, so switching re-reads and reparses that file. Atomic replacements temporarily stage new data while retaining the previous dataset. A failed or cancelled import never adds a list entry, re-importing the same name replaces that entry, and switching resets search/filters plus selection.
- Parsers: JSONL/NDJSON (one object per line, including `.json` files), header-based CSV, Apache/Nginx common or combined access logs, RFC3164-style syslog with optional priority or ISO timestamp, generic plain text.
- CSV supports quoted commas, escaped quotes and multiline fields. Headers must be unique/nonempty. Blank lines and headers are excluded from structured records, never removed from raw view.
- Raw/Structured toggle; fixed core columns plus discovered extra fields; full fields and original source in details. Failed records retain raw content and display a reason.
- JSONL/CSV use canonical field names (`timestamp`, `level`, `service`, `host`, `status`, `duration_ms`, `message`). Extra fields, including nested JSON, are retained. No JSON arrays or custom field mapping yet.
- Explicit ISO timestamps with timezone normalize to UTC. Legacy syslog year/timezone are unknown: retain `source_timestamp` rather than invent dates. Access-log custom trailing timing tokens retain `duration_raw`; units cannot safely be guessed.
- Decoded source text, offsets and parsed records are rebuilt in memory after reload from IndexedDB's original file Blob. Structured parsing uses more memory than raw viewing.
- Source text, offsets and records live in the log Worker. UI requests bounded windows and selected details. Cancelled imports/reparses preserve the previous dataset; revisions reject stale responses.
- Open the **Query** tab for count, latest 100 logs (timestamp descending, unknown timestamps last), or counts by level. First run lazily loads WASM and populates the `logs` table in batches. Replacements/reparses rebuild it transactionally on the next query.
- SQL schema: `source_line INTEGER`, `timestamp TIMESTAMPTZ`, `level/service/host VARCHAR`, `status INTEGER`, `duration_ms DOUBLE`, `message/raw VARCHAR`, `extras JSON`, `parse_error VARCHAR`. Failed records stay in SQL; blank lines/CSV headers do not. Nested and mixed-type extras stay JSON. SQL core names cannot be overwritten by extras.
- DuckDB uses its own engine Worker behind the existing log Worker. WASM, Worker script and pinned JSON extension are served by this app, not a CDN. Keep `public/duckdb-extensions` deployed; upgrade its version with the pinned DuckDB package.
- **Search + filters (Phase 5)**: the log Worker owns one filter result set at a time. Search (substring or RE2 regex, case-insensitive) hits `message` + `raw`; level/service/host exact; status 100–599; duration ≥ 0; time presets use the newest dataset timestamp, custom ranges need a timezone. Filtering runs as one parameterized SQL `WHERE` against `logs`; results are row-index lists, so Raw and Structured stay virtualized and consistent (raw shows original line numbers; structured shows filtered positions). Failed records can be filtered; blanks/CSV headers cannot appear. Regex is validated by running it inside the engine; a broken pattern keeps previous results and shows the engine error.
- Filter UI: debounced 250 ms, generation-ref cancellation, worker-owned generation re-check, `Filter changed.` staleness rejection. Highlights come from `regexp_extract_all` inside the engine Worker (first 2K chars), rendered as `<mark>`; a `●` marker (non-`<mark>`) denotes filter membership.
- The engine bundle is now `duckdb-eh` (exception handling): the MVP build fails inside prepared statements with `_setThrew is not defined` — including invalid-regex errors — so readable errors are only possible with EH. WASM is now ~36 MB (8.2 MB gzip).
- Database copies increase memory beyond the 50 MiB input cap. Clearing the workspace removes stored datasets and releases the Worker; saved queries and filter presets remain. SQL execution time excludes initialization/loading. The Query workspace accepts one read-only SQL statement at a time and converts/transfers at most 5,000 preview rows to React; later Arrow batches are counted without retaining a full JavaScript result array. DuckDB may still materialize the result internally.
- **Query workspace (Phase 6)**: the Query tab runs read-only SQL through DuckDB in the Worker. Results report execution time and total rows returned, while the UI transfers at most 5,000 preview rows. Clear invalidates stale in-flight responses. History and saved queries are persisted in IndexedDB. Parser-discovered fields remain in the `extras` JSON column. SQL text is not rewritten except by explicit Format, saved-query selection, starter selection, or Clear.
- **Analytics (Phase 7)**: the Analytics tab aggregates the active dataset in DuckDB for the applied filter scope. It shows records/errors/timestamped KPIs, logs and errors over time, levels, top services, top error messages, status codes, and average/p95 `duration_ms`. Unknown timestamps and missing latency values have explicit empty states. Category charts are bounded, and clicking a chart point reuses the normal explorer filter flow.
- **Persistence (Phase 8)**: IndexedDB stores original file Blobs and metadata for the imported workspace, per-dataset active filters, named filter presets, query history, saved queries, the active view, SQL draft, and active dataset. Reloading reconstructs and reparses the active File in the Worker. Parsed datasets, filter indexes, query results, and DuckDB tables are intentionally rebuilt rather than persisted; OPFS remains a later investigation.
- **Export + download (Phase 9)**: use **Export filtered logs** in Raw/Structured/Analytics for all matching structured records, or **Export query results** below a successful Query run. Both offer CSV, JSON and JSONL. **Download original** in any view downloads the exact uploaded bytes (including BOM, line endings and blank lines), also after reload. Export controls are disabled during import or until edited filters/SQL have been applied. Generation is indeterminate with a completion row count or a visible error; Clear, scope changes and unmount suppress late downloads.
- Tests: `bun test tests` covers reader, parsers and filter helpers; `bunx playwright test` covers all five parsers, raw/structured views, tolerant failures, multiline CSV, cancelled re-parsing, 100K structured rows, mobile layout, 50 MiB import regression, all three SQL presets, 100K SQL rows, replacement/reparse/empty datasets, and no external query-time requests. Phase 5 browser tests cover exact filtered rows for search/level/duration, detail + raw-view mapping with highlights, regex errors, SQL metacharacter quoting and empty states. Phase 6 browser tests cover arbitrary SQL, keyboard execution, formatting, clear, history ordering, saved-query lifecycle, invalid/read-only SQL, result truncation, dataset replacement and no external requests. Phase 7 browser tests cover aggregate dashboard values, latency, empty analytics scope, chart accessibility, click-to-filter behavior and no external requests. Phase 8 browser tests cover dataset/file restoration after reload, restored filters, query state, settings, named filter presets, clear persistence, and no external requests. Multi-file browser tests cover listing several files, switching with per-file parser memory, filter reset on switch, per-file removal, clearing the workspace, and same-name replacement.

## Export formats and limits

- Filtered-log exports retain complete `raw`, `extras` and `parse_error` fields in source-line order, regardless of preview truncation. JSON is an array of log objects; JSONL has one object per line. Nested extras stay JSON objects in these formats and JSON text in CSV.
- SQL exports re-execute the last successful SQL **unchanged**, without the 5,000-row UI cap. An explicit SQL limit still applies; nondeterministic expressions can return different values on the rerun. Edit the statement and run it before exporting again.
- Query JSON uses `{ "columns": ["name", "name"], "rows": [[1, 2]] }`. Query JSONL starts with a `{ "columns": [...] }` schema record followed by `{ "row": [...] }` records. Positional rows preserve duplicate SQL column names. CSV likewise preserves column order and duplicate headers.
- JSON retains null values. Large integers outside JavaScript's safe range and decimals become strings to preserve precision. Timestamps use millisecond-resolution ISO strings. CSV quotes text and preserves commas, quotes and multiline fields; null is an unquoted empty field. Empty exports remain valid: header-only CSV, `[]` for log JSON, no records for log JSONL, and schema plus no rows for query JSON/JSONL.
- CSV preserves cell content, including formula-like text. When opening untrusted logs in a spreadsheet, import cells as text rather than evaluating them.
- Serialization reads Arrow batches in the Worker and produces chunked Blob parts, not React row arrays. The completed Blob still consumes storage/memory proportional to output size, and DuckDB may internally materialize aggregates/sorts. There is no disk-streaming/OPFS export or user-facing export cancellation yet.
- `frontend/tests/export.test.ts` covers escaping, nested types, precision, multiple batches, empty output and stale/error rejection. `frontend/e2e/exports.spec.ts` verifies real downloaded bytes, combined filters, 6,000-row SQL downloads in every format, empty exports, duplicate columns, invalid drafts, recovery, and suppression of late downloads after Clear.

## Performance + polish (Phase 10)

- **Cancel query** interrupts the active query without discarding imported logs. `await client.cancelQuery()` targets the latest pending run; that query rejects with `AbortError`, and idle cancellation is a no-op. Cancellation works while queued, initializing, loading the table, executing, or fetching results. Database work stays serialized until rollback/reader cleanup finishes, so subsequent queries, filters, analytics and exports remain usable. Engine interruption is cooperative at DuckDB yield points; WASM startup and synchronous engine tasks cannot be forcibly preempted. Clear or leaving Query also cancels a pending run. This does not add export cancellation or change the read-only SQL policy/text.
- **Columns** in Structured and SQL results can be hidden and resized by dragging a header edge, typing a numeric width, or using the focused resize handle's Left/Right keys (Shift for larger steps; Home/End for bounds). Reset restores defaults. Structured source lines always remain visible and selectable, even when every log field is hidden; details/copy/exports retain all fields. Structured preferences are tab-local in `sessionStorage`; SQL column preferences last while that Query workspace is mounted. Duplicate SQL headers retain distinct positional values.
- **Theme**: choose Dark, Light or System in the header. IndexedDB remembers the preference; System follows live OS changes. Switching theme updates CodeMirror without replacing SQL text.
- **Keyboard**: `/` focuses search outside editable controls; Up/Down, Home/End and Enter navigate/inspect focused log tables; Escape closes details and returns focus to the table; Ctrl/Cmd+Enter runs SQL in the editor. The header's Shortcuts menu lists these. Input/editing controls keep their normal keys.
- **Details**: desktop panel/mobile drawer exposes field-name and complete-value copy buttons, raw-source copy, and an expandable formatted Parsed JSON view with its own copy button. Nested field values use compact JSON. Clipboard failures surface an error. Large records initially render at most 16,000 characters per value/source/JSON preview; Show full record expands them, while copy/download always retains full content. Selection/filter changes invalidate old details and copy feedback.
- **Feedback/recovery**: import progress, query/analytics loading, row/detail loading, empty filter/file states, errors and retry controls are visible. Query/Analytics lazy-view failures offer reload. Search remains debounced at 250 ms; generation/revision checks suppress stale responses.
- **Scale**: Raw/Structured views use bounded Worker windows (maximum 256 rows). Above 500,000 displayed rows, navigation uses 250,000-row segments to avoid browser scroll-height limits. Previous/next page, Jump to row, Home/End and cross-page arrow navigation use global display positions; details retain original source-line numbers, including sparse filtered raw results.
- **Memory**: a warning appears at 10 MiB input or 100,000 parsed records. The input limit is not a process-memory cap: source text, parsed records, filter indexes, DuckDB and completed export Blobs can occupy substantially more. Use filters/aggregates for large datasets and avoid wide unbounded SQL results; there is no OPFS/disk-spill guarantee or measured peak-memory bound.

### Verified scale workloads

Latest local Windows/Chromium **production-build** run, 1440×900 viewport, one Playwright worker. `frontend/e2e/scale.spec.ts` generates deterministic JSONL with 90% INFO / 10% ERROR, imports it successfully, checks exact SQL count/grouping, inspects first/middle/last records in both views, navigates segment boundaries, and checks sparse filtered source mapping. Each workload attaches its measurements to the Playwright result.

| Records | Input bytes | Import (ms) | First SQL count incl. initialization/load (ms) | Subsequent grouping (ms) | Max sampled rendered rows |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 349,890 | 161 | 2,239 | 116 | 28 |
| 100,000 | 3,598,890 | 828 | 3,279 | 133 | 26 |
| 1,100,000 | 40,798,890 | 13,020 | 11,958 | 192 | 24 |

These are single-run observations, not timing guarantees or peak-memory measurements. The largest sampled Worker request/response was 192 rows; the largest segmented spacer was 8,500,000 px. Separate under-50-MiB JSONL/CSV over-limit cases verify atomic rejection, including CSV-header accounting. Existing 50-MiB import, 100K parsing/SQL, mobile layout, Worker responsiveness, persistence and export regressions also pass.

Phase 10 browser coverage lives in `frontend/e2e/polish.spec.ts`, `frontend/e2e/table-columns.spec.ts`, `frontend/e2e/query-cancellation-worker.spec.ts` and `frontend/e2e/scale.spec.ts`. Cancellation tests use the real pinned engine/Worker and gate native messages to exercise races; clipboard tests substitute only the clipboard boundary to verify complete payloads and failure feedback.
