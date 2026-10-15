# Generated test logs

These synthetic UTF-8 JSONL files are safe local fixtures for exercising the
browser log analyzer. They contain no real or sensitive data.

| File | Records | Intended use |
| --- | ---: | --- |
| `small-rich-100.jsonl` | 100 | Detail panels, filters, typed fields, nested metadata, and quick manual checks |
| `scale-10000.jsonl` | 10,000 | Small performance baseline |
| `scale-100000.jsonl` | 100,000 | Large virtualized table/query checks |
| `scale-1100000.jsonl` | 1,100,000 | 1M+ segmented-navigation and DuckDB workload; remains below the 50 MiB cap |

Regenerate all files from the repository root with:

```bash
node generate-test-logs.mjs
```

The scale fixtures use nine `INFO` records followed by one `ERROR` record and
distinct `message` values (`r0`, `r1`, ...), matching the deterministic data
shape used by `frontend/e2e/scale.spec.ts`.
