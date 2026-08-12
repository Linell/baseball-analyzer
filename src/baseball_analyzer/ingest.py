"""The one ingest path: a CSV in data/source_data.csv's shape into one dataset."""

import csv
from pathlib import Path

from baseball_analyzer.db import Conn
from baseball_analyzer.definitions import in_zone

DERIVED_COLUMNS = ("pitcher_pitch_no", "times_through_order")

RANGED_TYPES = {"bigint", "integer", "double precision", "date"}


class IngestError(Exception):
    pass


def ingest_csv(
    conn: Conn,
    path: Path,
    key: str,
    name: str | None = None,
    is_reference: bool = False,
    replace: bool = False,
) -> dict[str, int]:
    """Load one CSV as one dataset. Returns row and pitch counts."""
    header = _read_header(path)
    _validate_header(conn, header)
    with conn.transaction():
        dataset_id = _create_dataset(conn, key, name or key, path.name, is_reference, replace)
        _copy_rows(conn, path, header, dataset_id)
        _compute_derived_columns(conn, dataset_id)
        _assert_zone_definition(conn, dataset_id)
        _write_manifest(conn, dataset_id, header)
        counts = _finalize_dataset(conn, dataset_id)
    return counts


def csv_row_count(path: Path) -> int:
    """Data rows in the file, for deciding whether an existing dataset is complete."""
    with path.open() as f:
        return sum(1 for _ in csv.reader(f)) - 1


def _read_header(path: Path) -> list[str]:
    with path.open() as f:
        return next(csv.reader(f))


def _table_columns(conn: Conn) -> dict[str, str]:
    rows = conn.execute(
        """
        select column_name, data_type from information_schema.columns
        where table_name = 'pitch'
        """
    ).fetchall()
    return {r["column_name"]: r["data_type"] for r in rows}


def _validate_header(conn: Conn, header: list[str]) -> None:
    if len(header) != len(set(header)):
        duplicates = sorted({c for c in header if header.count(c) > 1})
        raise IngestError(f"duplicate columns in header: {duplicates}")
    expected = set(_table_columns(conn)) - {"id", "dataset_id", *DERIVED_COLUMNS}
    missing = expected - set(header)
    unknown = set(header) - expected
    if missing or unknown:
        raise IngestError(
            f"header mismatch: missing {sorted(missing) or 'none'}, "
            f"unknown {sorted(unknown) or 'none'}"
        )


def _create_dataset(
    conn: Conn, key: str, name: str, source: str, is_reference: bool, replace: bool
) -> int:
    existing = conn.execute("select id from dataset where key = %s", (key,)).fetchone()
    if existing and not replace:
        raise IngestError(f"dataset {key!r} exists; pass --replace to reload it")
    if existing:
        conn.execute("delete from dataset where key = %s", (key,))
    row = conn.execute(
        "insert into dataset (key, name, source, is_reference) values (%s, %s, %s, %s)"
        " returning id",
        (key, name, source, is_reference),
    ).fetchone()
    assert row is not None
    return int(row["id"])


def _copy_rows(conn: Conn, path: Path, header: list[str], dataset_id: int) -> None:
    types = _table_columns(conn)
    columns = ", ".join(header)
    conn.execute(f"create temp table staging ({', '.join(f'{c} {types[c]}' for c in header)})")
    with (
        conn.cursor().copy(f"copy staging ({columns}) from stdin (format csv, header true)") as cp,
        path.open("rb") as f,
    ):
        while chunk := f.read(1 << 20):
            cp.write(chunk)
    conn.execute(
        f"insert into pitch (dataset_id, {columns}) select %s, {columns} from staging",
        (dataset_id,),
    )
    conn.execute("drop table staging")


def _compute_derived_columns(conn: Conn, dataset_id: int) -> None:
    """Both windows run over is_pitch rows only; pickoffs and step-offs stay null."""
    conn.execute(
        """
        update pitch set pitcher_pitch_no = numbered.n
        from (
            select id, row_number() over (
                partition by game_bam_id, pitcher_bam_id
                order by inning, bottom, at_bat_number, pitch_seq
            ) as n
            from pitch where dataset_id = %s and is_pitch
        ) numbered
        where pitch.id = numbered.id
        """,
        (dataset_id,),
    )
    conn.execute(
        """
        update pitch set times_through_order = ranked.n
        from (
            select id, dense_rank() over (
                partition by game_bam_id, pitcher_bam_id, batter_bam_id
                order by at_bat_number
            ) as n
            from pitch where dataset_id = %s and is_pitch
        ) ranked
        where pitch.id = ranked.id
        """,
        (dataset_id,),
    )


def _assert_zone_definition(conn: Conn, dataset_id: int) -> None:
    """The derived zone must reproduce the file's own in_zone column exactly."""
    rows = conn.execute(
        """
        select plate_x, plate_z, strikezone_top, strikezone_bot, in_zone
        from pitch
        where dataset_id = %s and is_pitch and in_zone is not null
          and plate_x is not null and plate_z is not null
          and strikezone_top is not null and strikezone_bot is not null
        """,
        (dataset_id,),
    ).fetchall()
    mismatches = sum(
        in_zone(r["plate_x"], r["plate_z"], r["strikezone_top"], r["strikezone_bot"])
        != r["in_zone"]
        for r in rows
    )
    if mismatches:
        raise IngestError(
            f"derived zone disagrees with in_zone on {mismatches} of {len(rows)} rows"
        )


def _write_manifest(conn: Conn, dataset_id: int, header: list[str]) -> None:
    types = _table_columns(conn)
    for column in [*header, *DERIVED_COLUMNS]:
        ranged = types[column] in RANGED_TYPES or types[column] == "boolean"
        expr = f"{column}::int" if types[column] == "boolean" else column
        min_max = (
            f"min({expr})::text as min_value, max({expr})::text as max_value"
            if ranged
            else "null as min_value, null as max_value"
        )
        row = conn.execute(
            f"select count({column}) as n, {min_max} from pitch where dataset_id = %s",
            (dataset_id,),
        ).fetchone()
        assert row is not None
        conn.execute(
            """
            insert into dataset_column
                (dataset_id, column_name, non_null_count, min_value, max_value, is_derived)
            values (%s, %s, %s, %s, %s, %s)
            """,
            (
                dataset_id,
                column,
                row["n"],
                row["min_value"],
                row["max_value"],
                column in DERIVED_COLUMNS,
            ),
        )


def _finalize_dataset(conn: Conn, dataset_id: int) -> dict[str, int]:
    row = conn.execute(
        """
        select count(*) as n_rows, count(*) filter (where is_pitch) as n_pitches,
               min(game_date) as start_date, max(game_date) as end_date
        from pitch where dataset_id = %s
        """,
        (dataset_id,),
    ).fetchone()
    assert row is not None
    conn.execute(
        "update dataset set row_count = %s, start_date = %s, end_date = %s where id = %s",
        (row["n_rows"], row["start_date"], row["end_date"], dataset_id),
    )
    return {"rows": row["n_rows"], "pitches": row["n_pitches"]}
