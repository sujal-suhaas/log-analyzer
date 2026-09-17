# Logline — Phase 5

Browser-based raw and structured log explorer. Phases 1–5 of the [roadmap](https://app.notion.com/p/Browser-Log-Analytics-Platform-Project-Roadmap-3dc528b4136d81579631e6fb72e6cbbe): local file import, virtual scrolling, Worker-owned parsing, DuckDB-WASM SQL presets and search + filters. Uploaded logs never go to the backend.

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
bun test tests              # reader edge cases (UTF-8 split, CRLF, empty, binary, abort, 100K lines)
bun run build               # type check + production build
bunx playwright test        # e2e: import, 50 MiB virtual scroll, cancel, mobile drawer, /health
```

## Scope & limits (Phase 5)

- One file at a time, UTF-8 text, max 50 MB / 1M lines, `.log .txt .json .csv .jsonl .ndjson`.
- Select parser before importing, or change it afterward to re-parse the current file. No format auto-detection.
- Parsers: JSONL/NDJSON (one object per line, including `.json` files), header-based CSV, Apache/Nginx common or combined access logs, RFC3164-style syslog with optional priority or ISO timestamp, generic plain text.
- CSV supports quoted commas, escaped quotes and multiline fields. Headers must be unique/nonempty. Blank lines and headers are excluded from structured records, never removed from raw view.
- Raw/Structured toggle; fixed core columns plus discovered extra fields; full fields and original source in details. Failed records retain raw content and display a reason.
- JSONL/CSV use canonical field names (`timestamp`, `level`, `service`, `host`, `status`, `duration_ms`, `message`). Extra fields, including nested JSON, are retained. No JSON arrays or custom field mapping yet.
- Explicit ISO timestamps with timezone normalize to UTC. Legacy syslog year/timezone are unknown: retain `source_timestamp` rather than invent dates. Access-log custom trailing timing tokens retain `duration_raw`; units cannot safely be guessed.
- In-memory source text, offsets and parsed records; cleared on reload (persistence is Phase 8). Structured parsing uses more memory than raw viewing.
- Source text, offsets and records live in the log Worker. UI requests bounded windows and selected details. Cancelled imports/reparses preserve the previous dataset; revisions reject stale responses.
- Open **SQL presets · DuckDB** for count, latest 100 logs (timestamp descending, unknown timestamps last), or counts by level. First run lazily loads WASM and populates the `logs` table in batches. Replacements/reparses rebuild it transactionally on the next query.
- SQL schema: `source_line INTEGER`, `timestamp TIMESTAMPTZ`, `level/service/host VARCHAR`, `status INTEGER`, `duration_ms DOUBLE`, `message/raw VARCHAR`, `extras JSON`, `parse_error VARCHAR`. Failed records stay in SQL; blank lines/CSV headers do not. Nested and mixed-type extras stay JSON. SQL core names cannot be overwritten by extras.
- DuckDB uses its own engine Worker behind the existing log Worker. WASM (~41 MB uncompressed), Worker script and pinned JSON extension are served by this app, not a CDN. Keep `public/duckdb-extensions` deployed; upgrade its version with the pinned DuckDB package.
- **Search + filters (Phase 5)**: the log Worker owns one filter result set at a time. Search (substring or RE2 regex, case-insensitive) hits `message` + `raw`; level/service/host exact; status 100–599; duration ≥ 0; time presets use the newest dataset timestamp, custom ranges need a timezone. Filtering runs as one parameterized SQL `WHERE` against `logs`; results are row-index lists, so Raw and Structured stay virtualized and consistent (raw shows original line numbers; structured shows filtered positions). Failed records can be filtered; blanks/CSV headers cannot appear. Regex is validated by running it inside the engine; a broken pattern keeps previous results and shows the engine error.
- Filter UI: debounced 250 ms, generation-ref cancellation, worker-owned generation re-check, `Filter changed.` staleness rejection. Highlights come from `regexp_extract_all` inside the engine Worker (first 2K chars), rendered as `<mark>`; a `●` marker (non-`<mark>`) denotes filter membership.
- The engine bundle is now `duckdb-eh` (exception handling): the MVP build fails inside prepared statements with `_setThrew is not defined` — including invalid-regex errors — so readable errors are only possible with EH. WASM is now ~36 MB (8.2 MB gzip).
- Database copies increase memory beyond the 50 MiB input cap. Reload/Clear releases data; no persistence yet. SQL execution time excludes initialization/loading. SQL presets have no query cancellation yet; full editor, search and filters remain later phases.
- Tests: `bun test tests` covers reader and parsers; `bunx playwright test` covers all five parsers, raw/structured views, tolerant failures, multiline CSV, cancelled re-parsing, 100K structured rows, mobile layout, 50 MiB import regression, all three SQL presets, 100K SQL rows, replacement/reparse/empty datasets, and no external query-time requests. Phase 5 browser tests cover exact filtered rows for search/level/duration, detail + raw-view mapping with highlights, regex errors, SQL metacharacter quoting and empty states.
