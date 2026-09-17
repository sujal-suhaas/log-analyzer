# Logline — Phase 1

Browser-based raw log explorer. Phase 1 of the [roadmap](https://app.notion.com/p/Browser-Log-Analytics-Platform-Project-Roadmap-3dc528b4136d81579631e6fb72e6cbbe): dashboard shell, file import, raw viewer. No parsing, no upload — everything stays in the browser.

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

## Scope & limits (Phase 1)

- One file at a time, UTF-8 text, max 50 MB / 1M lines, `.log .txt .json .csv .jsonl .ndjson`.
- Content is raw lines only — JSON/CSV are not parsed yet (Phase 2).
- In-memory text + line offsets; cleared on reload (persistence is Phase 8).
- No Worker yet (Phase 3); imports yield between chunks to keep UI responsive.
