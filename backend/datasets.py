"""Deterministic demo datasets served by the API.

Each dataset targets one parser the browser app ships, so a download can be
dropped straight into the importer without renaming anything. Output is a pure
function of (dataset, records, seed): the same request always returns the same
bytes, which keeps downloads cacheable and tests exact.

This is deliberately separate from generate_logs.py: that module writes one
arbitrary generic file for the CLI and POST /generate, while these five shapes
are curated to exercise specific parsers (access logs, correlated request ids).
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterator

START = datetime(2026, 1, 1, tzinfo=timezone.utc)
MAX_RECORDS = 1_250_000  # the app's physical source-line cap
MAX_BYTES = 50 * 1024 * 1024  # the app's import cap
DEFAULT_SEED = 42


@dataclass(frozen=True)
class Dataset:
    id: str
    name: str
    description: str
    parser: str
    extension: str
    media_type: str
    records: int


CATALOG: tuple[Dataset, ...] = (
    Dataset(
        id="api-server",
        name="API server logs",
        description="JSONL request logs for a three-service API tier with mixed levels and status codes.",
        parser="jsonl",
        extension="jsonl",
        media_type="application/x-ndjson",
        records=1000,
    ),
    Dataset(
        id="auth-service",
        name="Authentication logs",
        description="JSONL login attempts: successes, failed passwords, expired tokens and lockouts.",
        parser="jsonl",
        extension="jsonl",
        media_type="application/x-ndjson",
        records=1000,
    ),
    Dataset(
        id="payment-service",
        name="Payment service logs",
        description="JSONL payment lifecycle events with nested retry metadata and latency.",
        parser="jsonl",
        extension="jsonl",
        media_type="application/x-ndjson",
        records=1000,
    ),
    Dataset(
        id="nginx-access",
        name="Nginx access logs",
        description="Combined-format access log lines: client, request, status, bytes, referer and agent.",
        parser="access",
        extension="log",
        media_type="text/plain; charset=utf-8",
        records=1000,
    ),
    Dataset(
        id="distributed",
        name="Distributed service logs",
        description="JSONL gateway and worker events sharing a request_id, for correlating one request across services.",
        parser="jsonl",
        extension="jsonl",
        media_type="application/x-ndjson",
        records=1000,
    ),
)

BY_ID = {dataset.id: dataset for dataset in CATALOG}


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _level(rng: random.Random) -> str:
    return rng.choice(["INFO"] * 7 + ["WARN"] * 2 + ["ERROR"])


def _api(count: int, rng: random.Random) -> Iterator[str]:
    messages = [
        "request completed",
        "cache miss, fetching from origin",
        "database connection acquired",
        "upstream timeout, retrying",
        "rate limit exceeded for client",
    ]
    for index in range(count):
        level = _level(rng)
        yield json.dumps(
            {
                "timestamp": _iso(START + timedelta(milliseconds=250 * index)),
                "level": level,
                "service": rng.choice(["api-gateway", "orders-api", "search-api"]),
                "host": f"web-{rng.randint(1, 3):02d}",
                "status": 500 if level == "ERROR" else rng.choice([200, 200, 201, 204, 404]),
                "duration_ms": rng.randint(3, 2500),
                "message": rng.choice(messages),
                "request_id": f"req-{index:07d}",
            }
        )


def _auth(count: int, rng: random.Random) -> Iterator[str]:
    events = [
        ("INFO", 200, "login succeeded"),
        ("WARN", 401, "invalid password"),
        ("WARN", 403, "account locked after repeated failures"),
        ("INFO", 200, "token refreshed"),
        ("WARN", 401, "expired refresh token"),
    ]
    for index in range(count):
        level, status, message = rng.choice(events)
        yield json.dumps(
            {
                "timestamp": _iso(START + timedelta(milliseconds=400 * index)),
                "level": level,
                "service": "auth-api",
                "host": f"auth-{rng.randint(1, 2):02d}",
                "status": status,
                "duration_ms": rng.randint(5, 900),
                "message": message,
                "user_id": f"user-{rng.randint(1, 250):04d}",
                "request_id": f"auth-{index:07d}",
            }
        )


def _payment(count: int, rng: random.Random) -> Iterator[str]:
    events = [
        ("INFO", "payment intent created"),
        ("INFO", "payment intent confirmed"),
        ("ERROR", "card declined"),
        ("ERROR", "processor timeout"),
        ("WARN", "retry scheduled"),
    ]
    for index in range(count):
        level, message = rng.choice(events)
        yield json.dumps(
            {
                "timestamp": _iso(START + timedelta(milliseconds=700 * index)),
                "level": level,
                "service": "payment-api",
                "host": f"pay-{rng.randint(1, 2):02d}",
                "status": 502 if level == "ERROR" else 201,
                "duration_ms": rng.randint(20, 4000),
                "message": message,
                "request_id": f"pay-{index:07d}",
                "metadata": {
                    "attempt": rng.randint(1, 3),
                    "region": rng.choice(["eu-west", "us-east"]),
                    "amount_cents": rng.randrange(100, 50_000, 100),
                },
            }
        )


def _access(count: int, rng: random.Random) -> Iterator[str]:
    paths = ["/api/orders", "/api/search", "/api/payments", "/health", "/api/users/42"]
    agents = ["curl/8.5.0", "Mozilla/5.0 (X11; Linux x86_64)", "python-requests/2.32"]
    for index in range(count):
        moment = START + timedelta(milliseconds=150 * index)
        status = rng.choice([200, 200, 200, 201, 301, 304, 400, 401, 404, 500, 502])
        request = f"{rng.choice(['GET', 'POST', 'GET', 'HEAD'])} {rng.choice(paths)} HTTP/1.1"
        yield (
            f"10.0.{rng.randint(0, 3)}.{rng.randint(1, 254)} - - "
            f"[{moment.strftime('%d/%b/%Y:%H:%M:%S')} +0000] "
            f'"{request}" {status} {rng.randint(120, 24000)} "-" "{rng.choice(agents)}"'
        )


def _distributed(count: int, rng: random.Random) -> Iterator[str]:
    # One request per two lines: the gateway accepts it, a worker finishes it.
    services = ["gateway", "orders-worker"]
    messages = {
        "gateway": ["request received", "routing to orders-worker", "response returned"],
        "orders-worker": ["job started", "job finished", "job retried"],
    }
    emitted = 0
    request = 0
    while emitted < count:
        request_id = f"req-{request:07d}"
        for service in services:
            if emitted >= count:
                return
            level = _level(rng)
            yield json.dumps(
                {
                    "timestamp": _iso(START + timedelta(milliseconds=90 * emitted)),
                    "level": level,
                    "service": service,
                    "host": f"{service}-{rng.randint(1, 2):02d}",
                    "status": 500 if level == "ERROR" else 200,
                    "duration_ms": rng.randint(1, 1800),
                    "message": rng.choice(messages[service]),
                    "request_id": request_id,
                }
            )
            emitted += 1
        request += 1


RENDERERS = {
    "api-server": _api,
    "auth-service": _auth,
    "payment-service": _payment,
    "nginx-access": _access,
    "distributed": _distributed,
}


def get(dataset_id: str) -> Dataset | None:
    return BY_ID.get(dataset_id)


def info(dataset: Dataset) -> dict:
    return {
        "id": dataset.id,
        "name": dataset.name,
        "description": dataset.description,
        "parser": dataset.parser,
        "extension": dataset.extension,
        "media_type": dataset.media_type,
        "records": dataset.records,
        "download_url": f"/datasets/{dataset.id}/download",
    }


def lines(dataset: Dataset, records: int | None = None, seed: int = DEFAULT_SEED) -> Iterator[str]:
    """Newline-terminated lines for `dataset`; identical input yields identical bytes."""
    count = dataset.records if records is None else records
    if count < 1 or count > MAX_RECORDS:
        raise ValueError(f"records must be between 1 and {MAX_RECORDS:,}")
    rng = random.Random(seed)
    for line in RENDERERS[dataset.id](count, rng):
        yield line + "\n"


def payload(dataset: Dataset, records: int | None = None, seed: int = DEFAULT_SEED) -> Iterator[bytes]:
    for line in lines(dataset, records, seed):
        yield line.encode("utf-8")
