"""Database connection and migrations."""

import os
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

Conn = psycopg.Connection[dict[str, Any]]

DEFAULT_URL = "postgresql://postgres:postgres@localhost:5433/baseball"
MIGRATIONS_DIR = Path(__file__).parents[2] / "migrations"


def connect(url: str | None = None) -> Conn:
    return psycopg.Connection.connect(
        url or os.environ.get("DATABASE_URL", DEFAULT_URL), row_factory=dict_row
    )


def migrate(conn: Conn) -> list[str]:
    """Apply migrations/*.sql in name order; return the names applied."""
    if not MIGRATIONS_DIR.is_dir():
        # A mislaid layout would otherwise report "applied: nothing new".
        raise RuntimeError(f"migrations directory missing: {MIGRATIONS_DIR}")
    conn.execute("create table if not exists schema_migration (name text primary key)")
    done = {r["name"] for r in conn.execute("select name from schema_migration")}
    applied = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in done:
            continue
        conn.execute(path.read_text())
        conn.execute("insert into schema_migration (name) values (%s)", (path.name,))
        applied.append(path.name)
    conn.commit()
    return applied
