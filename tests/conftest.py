import csv
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest
from flask.testing import FlaskClient

from baseball_analyzer import db
from baseball_analyzer.db import Conn
from baseball_analyzer.ingest import ingest_csv

SOURCE_CSV = Path(__file__).parents[1] / "data" / "source_data.csv"


@pytest.fixture(scope="session")
def source_rows() -> list[dict[str, str]]:
    with SOURCE_CSV.open() as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="session")
def pitch_rows(source_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [r for r in source_rows if r["is_pitch"] == "TRUE"]


@pytest.fixture(scope="session")
def test_db_url() -> str:
    """A fresh baseball_test database; skips db tests when postgres is down."""
    try:
        admin = db.connect()
    except psycopg.OperationalError:
        pytest.skip("postgres is not running (make db-up)")
    admin.autocommit = True
    admin.execute("drop database if exists baseball_test")
    admin.execute("create database baseball_test")
    admin.close()
    base_url = os.environ.get("DATABASE_URL", db.DEFAULT_URL)
    return base_url.rsplit("/", 1)[0] + "/baseball_test"


@pytest.fixture(scope="session")
def conn(test_db_url: str) -> Iterator[Conn]:
    """Migrated and loaded twice over: the file as two distinct datasets."""
    connection = db.connect(test_db_url)
    db.migrate(connection)
    ingest_csv(connection, SOURCE_CSV, "padres_july2024", "Padres July 2024")
    ingest_csv(connection, SOURCE_CSV, "second_copy", "Second Copy")
    connection.commit()
    yield connection
    connection.close()


@pytest.fixture()
def client(test_db_url: str, conn: Conn, monkeypatch: pytest.MonkeyPatch) -> FlaskClient:
    monkeypatch.setenv("DATABASE_URL", test_db_url)
    from baseball_analyzer.api import app

    return app.test_client()


def get_json(client: FlaskClient, url: str) -> dict[str, Any]:
    body = client.get(url).json
    assert isinstance(body, dict)
    return body
