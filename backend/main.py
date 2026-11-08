from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import datasets
from generate_logs import EXTENSIONS, iter_lines

app = FastAPI(title="Logline", version="0.2.0")

# The app is served from Vite (dev 5173, preview 4173) and calls this API cross
# origin. Only loopback origins are allowed; the API holds no user data.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["GET", "POST"],
    allow_headers=["content-type"],
)

# Fixed origin for generated timestamps so a download is reproducible.
START = datetime(2026, 1, 1, tzinfo=timezone.utc)
PARSERS = {".json": "jsonl", ".jsonl": "jsonl", ".ndjson": "jsonl",
           ".csv": "csv", ".log": "plain", ".txt": "plain"}


class GenerateRequest(BaseModel):
    extension: str = Field(default=".jsonl", description="Output extension; picks the format.")
    lines: int = Field(default=1000, ge=1, le=datasets.MAX_RECORDS)
    size_bytes: int | None = Field(
        default=None, ge=1, le=datasets.MAX_BYTES,
        description="Write until this size instead of `lines`.",
    )
    seed: int | None = Field(default=None, description="Seed for reproducible output.")


def _dataset(dataset_id: str) -> datasets.Dataset:
    dataset = datasets.get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail=f"Unknown dataset {dataset_id!r}.")
    return dataset


def _download_name(dataset_id: str, extension: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="logline-{dataset_id}.{extension}"'}


def _prepend(first: str, rest: Iterator[str]) -> Iterator[str]:
    if first:
        yield first
    yield from rest


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/datasets")
def list_datasets() -> dict[str, list[dict]]:
    return {"datasets": [datasets.info(dataset) for dataset in datasets.CATALOG]}


@app.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict:
    return datasets.info(_dataset(dataset_id))


@app.get("/datasets/{dataset_id}/download")
def download_dataset(
    dataset_id: str,
    records: int | None = Query(default=None, ge=1, le=datasets.MAX_RECORDS),
    seed: int = Query(default=datasets.DEFAULT_SEED),
) -> StreamingResponse:
    dataset = _dataset(dataset_id)
    return StreamingResponse(
        datasets.payload(dataset, records, seed),
        media_type=dataset.media_type,
        headers=_download_name(dataset.id, dataset.extension),
    )


@app.post("/generate")
def generate_logs(request: GenerateRequest) -> StreamingResponse:
    """Generic generated log file: any supported extension, by line count or size.

    The `parser` hint in the response header is what the app's importer should
    select; the body is the file itself.
    """
    extension = request.extension.lower()
    if not extension.startswith("."):
        extension = f".{extension}"
    if extension not in EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported extension {extension!r}; use one of {sorted(EXTENSIONS)}.",
        )
    try:
        body = iter_lines(
            extension,
            lines=request.lines,
            size_bytes=request.size_bytes,
            seed=request.seed,
            start=START,
        )
        # Pull the first chunk now so a bad request fails before streaming starts.
        first = next(body, "")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    headers = _download_name("generated", extension.lstrip("."))
    headers["X-Parser"] = PARSERS.get(extension, "plain")
    return StreamingResponse(
        _prepend(first, body),
        media_type="text/csv; charset=utf-8" if extension == ".csv" else "text/plain; charset=utf-8",
        headers=headers,
    )
