# Logline — Phase 2

Browser-based raw and structured log explorer. Phases 1–2 of the [roadmap](https://app.notion.com/p/Browser-Log-Analytics-Platform-Project-Roadmap-3dc528b4136d81579631e6fb72e6cbbe): local file import, virtual scrolling and parsing. Uploaded logs never go to the backend.

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

## Scope & limits (Phase 2)

- One file at a time, UTF-8 text, max 50 MB / 1M lines, `.log .txt .json .csv .jsonl .ndjson`.
- Select parser before importing, or change it afterward to re-parse the current file. No format auto-detection.
- Parsers: JSONL/NDJSON (one object per line, including `.json` files), header-based CSV, Apache/Nginx common or combined access logs, RFC3164-style syslog with optional priority or ISO timestamp, generic plain text.
- CSV supports quoted commas, escaped quotes and multiline fields. Headers must be unique/nonempty. Blank lines and headers are excluded from structured records, never removed from raw view.
- Raw/Structured toggle; fixed core columns plus discovered extra fields; full fields and original source in details. Failed records retain raw content and display a reason.
- JSONL/CSV use canonical field names (`timestamp`, `level`, `service`, `host`, `status`, `duration_ms`, `message`). Extra fields, including nested JSON, are retained. No JSON arrays or custom field mapping yet.
- Explicit ISO timestamps with timezone normalize to UTC. Legacy syslog year/timezone are unknown: retain `source_timestamp` rather than invent dates. Access-log custom trailing timing tokens retain `duration_raw`; units cannot safely be guessed.
- In-memory source text, offsets and parsed records; cleared on reload (persistence is Phase 8). Structured parsing uses more memory than raw viewing.
- No Worker yet (Phase 3); reading/parsing yields between batches and supports cancellation. A single huge record can still pause the main thread.
- Tests: `bun test tests` covers reader and parsers; `bunx playwright test` covers all five parsers, raw/structured views, tolerant failures, multiline CSV, cancelled re-parsing, 100K structured rows, mobile layout and 50 MiB import regression.
