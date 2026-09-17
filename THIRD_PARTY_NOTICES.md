# Third-party notices

- [Watermelon UI](https://ui.watermelon.sh) — `src/components/file-import.tsx` adapted from the
  `file-upload-1` block (https://github.com/WatermelonCorp/watermelon-platform), MIT License,
  Copyright (c) 2026 Watermelon Platform Contributors. Modified: simulated upload replaced with
  local file reading; simplified for dark dashboard.
- [DuckDB](https://www.duckdb.org) — `@duckdb/duckdb-wasm` dependency and the bundled
  JSON extension (`frontend/public/duckdb-extensions/`), MIT License, Copyright (c)
  2018–2025 Stichting DuckDB Foundation. Vendored: `json.duckdb_extension.wasm`
  (SHA-256 `15a89d3f…`, see local README) so query setup needs no external host.
- Geist font — bundled by shadcn init via @fontsource-variable/geist, SIL OFL 1.1.
