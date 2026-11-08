import json
import re

import pytest
from fastapi.testclient import TestClient

import datasets
import main

client = TestClient(main.app)

# The browser app's access parser; a download must satisfy it verbatim.
ACCESS = re.compile(
    r'^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?(?: (\S+))?$'
)
# Parser ids the frontend ships.
PARSERS = {"jsonl", "csv", "access", "syslog", "plain"}


def lines(response) -> list[str]:
    return response.text.splitlines()


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_catalog_lists_every_dataset_with_a_real_parser():
    body = client.get("/datasets").json()
    ids = [dataset["id"] for dataset in body["datasets"]]
    assert ids == ["api-server", "auth-service", "payment-service", "nginx-access", "distributed"]
    for dataset in body["datasets"]:
        assert dataset["parser"] in PARSERS
        assert dataset["extension"] in {"jsonl", "log"}
        assert dataset["download_url"] == f"/datasets/{dataset['id']}/download"
        assert dataset["records"] > 0


def test_dataset_metadata_and_unknown_id():
    assert client.get("/datasets/nginx-access").json()["parser"] == "access"
    assert client.get("/datasets/nope").status_code == 404
    assert client.get("/datasets/nope/download").status_code == 404


def test_download_is_reproducible_and_has_the_requested_length():
    first = client.get("/datasets/api-server/download?records=50")
    second = client.get("/datasets/api-server/download?records=50")
    assert first.status_code == 200
    assert first.content == second.content, "same request must yield the same bytes"
    assert first.headers["content-disposition"] == 'attachment; filename="logline-api-server.jsonl"'
    assert len(lines(first)) == 50
    for line in lines(first):
        record = json.loads(line)
        assert {"timestamp", "level", "message"} <= record.keys()


def test_download_rejects_out_of_range_record_counts():
    assert client.get("/datasets/api-server/download?records=0").status_code == 422
    assert client.get(f"/datasets/api-server/download?records={datasets.MAX_RECORDS + 1}").status_code == 422


def test_jsonl_datasets_all_parse():
    for dataset_id in ("api-server", "auth-service", "payment-service", "distributed"):
        body = client.get(f"/datasets/{dataset_id}/download?records=25")
        assert body.status_code == 200
        for line in lines(body):
            json.loads(line)


def test_nginx_dataset_matches_the_access_parser():
    body = client.get("/datasets/nginx-access/download?records=25")
    assert body.headers["content-type"].startswith("text/plain")
    for line in lines(body):
        assert ACCESS.match(line), line


def test_distributed_dataset_correlates_a_request_across_services():
    records = [json.loads(line) for line in lines(client.get("/datasets/distributed/download?records=20"))]
    by_request: dict[str, set[str]] = {}
    for record in records:
        by_request.setdefault(record["request_id"], set()).add(record["service"])
    assert any(len(services) == 2 for services in by_request.values())


def test_generate_by_line_count_and_parser_hint():
    body = client.post("/generate", json={"extension": ".jsonl", "lines": 40, "seed": 7})
    assert body.status_code == 200
    assert body.headers["x-parser"] == "jsonl"
    assert body.headers["content-disposition"] == 'attachment; filename="logline-generated.jsonl"'
    assert len(lines(body)) == 40


def test_generate_is_reproducible_with_a_seed():
    first = client.post("/generate", json={"extension": ".log", "lines": 20, "seed": 11})
    second = client.post("/generate", json={"extension": ".log", "lines": 20, "seed": 11})
    assert first.content == second.content


def test_generate_by_size_stops_at_the_target():
    target = 4096
    body = client.post("/generate", json={"extension": ".jsonl", "size_bytes": target, "seed": 3})
    assert body.status_code == 200
    size = len(body.content)
    assert size >= target
    # Stops after crossing the target, never far beyond it.
    assert size - target < 400


def test_generate_csv_starts_with_a_header():
    body = client.post("/generate", json={"extension": ".csv", "lines": 5, "seed": 2})
    assert body.status_code == 200
    assert lines(body)[0] == "timestamp,level,service,host,status,duration_ms,message"
    assert len(lines(body)) == 6


def test_generate_rejects_bad_requests():
    assert client.post("/generate", json={"extension": ".zip", "lines": 5}).status_code == 422
    assert client.post("/generate", json={"extension": ".jsonl", "lines": 0}).status_code == 422
    assert client.post("/generate", json={"extension": ".jsonl", "size_bytes": 0}).status_code == 422
    too_big = datasets.MAX_BYTES + 1
    assert client.post("/generate", json={"extension": ".jsonl", "size_bytes": too_big}).status_code == 422


@pytest.mark.parametrize("extension", [".json", ".jsonl", ".ndjson", ".csv", ".log", ".txt"])
def test_generate_supports_every_extension(extension):
    assert client.post("/generate", json={"extension": extension, "lines": 3, "seed": 1}).status_code == 200
