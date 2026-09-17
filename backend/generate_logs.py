"""Generate sample log files: any extension, by line count or byte size.

Usage:
  python generate_logs.py --lines 10000 --out sample.log
  python generate_logs.py --size-mb 50 --out payment.jsonl
  python generate_logs.py --size-mb 5 --out access.csv --seed 42
"""
import argparse
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

LEVELS = ["INFO"] * 6 + ["WARN"] * 2 + ["ERROR"] + ["DEBUG"]
SERVICES = ["auth-api", "payment-api", "gateway", "search-api", "worker"]
HOSTS = ["web-01", "web-02", "db-01"]
STATUSES = [200, 200, 200, 200, 201, 204, 301, 400, 401, 404, 500, 502, 503]
MESSAGES = [
    "request completed",
    "database connection acquired",
    "cache miss, fetching from origin",
    "payment intent confirmed",
    "token refreshed successfully",
    "database timeout after 30s",
    "upstream timeout, retrying",
    "rate limit exceeded for client",
    "scheduled job finished",
    "connection pool exhausted",
]
EXTENSIONS = {".log", ".txt", ".json", ".jsonl", ".ndjson", ".csv"}


def _make_line(cursor: datetime, service: str, host: str, level: str,
               status: int, duration: int, message: str, ext: str) -> str:
    ts = cursor.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if ext in {".json", ".jsonl", ".ndjson"}:
        return json.dumps({"timestamp": ts, "level": level, "service": service, "host": host,
                           "status": status, "duration_ms": duration, "message": message})
    if ext == ".csv":
        # ponytail: hand-rolled quoting; safe while messages stay comma-free from this list,
        # switch to csv.writer if messages ever become user-supplied.
        return f"{ts},{level},{service},{host},{status},{duration},{message}"
    return f"{ts} {level:<5} {service:<12} {host:<6} {status} {duration:>4}ms {message}"


def generate(out: str, lines: int = 1000, size_bytes: int | None = None, seed: int | None = None) -> dict:
    """Write log lines to `out` until `lines` or `size_bytes` (whichever applies) is reached."""
    path = Path(out)
    ext = path.suffix.lower()
    if ext not in EXTENSIONS:
        raise ValueError(f"Unsupported extension {ext!r}; use one of {sorted(EXTENSIONS)}")
    if lines < 0 or (size_bytes is not None and size_bytes < 1):
        raise ValueError("lines must be >= 0 and size_bytes >= 1")
    rng = random.Random(seed)
    cursor = datetime.now(timezone.utc) - timedelta(hours=1)
    header = "timestamp,level,service,host,status,duration_ms,message\n" if ext == ".csv" else None
    count, written = 0, 0
    with open(path, "w", encoding="utf-8", newline="") as f:
        if header:
            f.write(header)
            written += len(header)
        while (size_bytes is None and count < lines) or (size_bytes is not None and written < size_bytes):
            cursor += timedelta(milliseconds=rng.randint(1, 50))
            line = _make_line(cursor, rng.choice(SERVICES), rng.choice(HOSTS),
                              rng.choice(LEVELS), rng.choice(STATUSES), rng.randint(1, 5000),
                              rng.choice(MESSAGES), ext)
            f.write(line + "\n")
            written += len(line) + 1
            count += 1
    return {"path": str(path), "lines": count, "bytes": written}


def format_bytes(n: float) -> str:
    if n < 1024:
        return f"{n:.0f} B"
    for unit in ("KB", "MB", "GB"):
        n /= 1024
        if n < 1024:
            return f"{n:.1f} {unit}"
    return f"{n:.1f} GB"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="sample.log", help="output file; extension picks the format")
    parser.add_argument("--lines", type=int, default=1000, help="number of log lines (default 1000)")
    parser.add_argument("--size-mb", type=float, help="write until file reaches this size in MB (overrides --lines)")
    parser.add_argument("--seed", type=int, help="seed for reproducible output")
    args = parser.parse_args()
    try:
        stats = generate(args.out, lines=args.lines,
                         size_bytes=int(args.size_mb * 1024 * 1024) if args.size_mb else None,
                         seed=args.seed)
    except ValueError as error:
        parser.exit(2, f"error: {error}\n")
    print(f"{stats['path']}: {stats['lines']:,} lines, {format_bytes(stats['bytes'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
