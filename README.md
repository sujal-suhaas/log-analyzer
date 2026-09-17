# Logline — Phase 4

Browser-based raw and structured log explorer. Phases 1–4 of the [roadmap](https://app.notion.com/p/Browser-Log-Analytics-Platform-Project-Roadmap-3dc528b4136d81579631e6fb72e6cbbe): local file import, virtual scrolling, Worker-owned parsing and DuckDB-WASM SQL presets. Uploaded logs never go to the backend.

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

## Scope & limits (Phase 4)

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
- Database copies increase memory beyond the 50 MiB input cap. Reload/Clear releases data; no persistence yet. SQL execution time excludes initialization/loading. SQL presets have no query cancellation yet; full editor, search and filters remain later phases.
- Tests: `bun test tests` covers reader and parsers; `bunx playwright test` covers all five parsers, raw/structured views, tolerant failures, multiline CSV, cancelled re-parsing, 100K structured rows, mobile layout, 50 MiB import regression, all three SQL presets, 100K SQL rows, replacement/reparse/empty datasets, and no external query-time requests.
