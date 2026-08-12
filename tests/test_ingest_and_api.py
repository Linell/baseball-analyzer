"""Datasets are first-class and never implicitly unioned."""

import pytest
from flask.testing import FlaskClient

from baseball_analyzer.db import Conn
from tests.conftest import get_json

pytestmark = pytest.mark.db


def one(conn: Conn, sql: str, params: tuple[object, ...] = ()) -> int:
    """Run a query returning a single integer."""
    row = conn.execute(sql, params).fetchone()
    assert row is not None
    return int(next(iter(row.values())))


def dataset_id(conn: Conn, key: str) -> int:
    return one(conn, "select id from dataset where key = %s", (key,))


def test_every_row_lands_with_a_dataset_id(conn: Conn) -> None:
    for key in ("padres_july2024", "second_copy"):
        n = one(conn, "select count(*) from pitch where dataset_id = %s", (dataset_id(conn, key),))
        assert n == 6554


def test_routes_return_rows_from_exactly_one_dataset(client: FlaskClient) -> None:
    """With the same file loaded twice, nothing doubles."""
    batters = get_json(client, "/batters?dataset=padres_july2024")["batters"]
    assert len(batters) == 7  # the qualifying hitters once each, not unioned
    batter = batters[0]["bam_id"]
    pitches = get_json(client, f"/pitches?dataset=padres_july2024&batter={batter}")["pitches"]
    assert len(pitches) == batters[0]["pitches"]
    assert batters == get_json(client, "/batters?dataset=second_copy")["batters"]


def test_unknown_dataset_404s(client: FlaskClient) -> None:
    assert client.get("/batters?dataset=nope").status_code == 404
    assert client.get("/zone?dataset=nope&batter=1").status_code == 404
    assert client.get("/batters").status_code == 400


def test_derived_pitcher_pitch_no(conn: Conn) -> None:
    ds = dataset_id(conn, "padres_july2024")
    assert one(conn, "select max(pitcher_pitch_no) from pitch where dataset_id = %s", (ds,)) == 114
    non_pitch = one(
        conn,
        "select count(*) from pitch where dataset_id = %s and not is_pitch"
        " and pitcher_pitch_no is not null",
        (ds,),
    )
    assert non_pitch == 0
    violations = one(
        conn,
        """
        with ordered as (
            select pitcher_pitch_no - lag(pitcher_pitch_no) over (
                partition by game_bam_id, pitcher_bam_id
                order by inning, bottom, at_bat_number, pitch_seq
            ) as step
            from pitch where dataset_id = %s and is_pitch
        )
        select count(*) from ordered where step is not null and step <> 1
        """,
        (ds,),
    )
    assert violations == 0
    starter_range = conn.execute(
        """
        select min(n) as lo, max(n) as hi from (
            select max(pitcher_pitch_no) as n
            from pitch where dataset_id = %s and is_pitch and pitcher_type = 'S'
            group by game_bam_id, pitcher_bam_id
        ) appearances
        """,
        (ds,),
    ).fetchone()
    assert starter_range is not None
    # the file's shortest start is Mazur's 39-pitch injury outing (docs/DATA.md)
    assert (starter_range["lo"], starter_range["hi"]) == (39, 114)


def test_derived_times_through_order_splits(conn: Conn) -> None:
    ds = dataset_id(conn, "padres_july2024")
    rows = conn.execute(
        """
        select times_through_order as tto, count(*) as n
        from pitch where dataset_id = %s and is_pitch
        group by times_through_order order by times_through_order
        """,
        (ds,),
    ).fetchall()
    # a fourth trip through the order exists, 6 pitches (docs/DATA.md)
    assert [(r["tto"], r["n"]) for r in rows] == [(1, 4159), (2, 1507), (3, 759), (4, 6)]


def test_manifest_counts_ranges_and_derived_flags(conn: Conn) -> None:
    ds = dataset_id(conn, "padres_july2024")
    manifest = {
        r["column_name"]: r
        for r in conn.execute(
            "select * from dataset_column where dataset_id = %s", (ds,)
        ).fetchall()
    }
    assert manifest["bat_speed"]["non_null_count"] == 3130
    assert manifest["hit_exit_speed"]["non_null_count"] == 2273
    # a printed min/max is the cheapest thing that catches feet-versus-inches
    assert (
        -4 < float(manifest["plate_x"]["min_value"]) < float(manifest["plate_x"]["max_value"]) < 4
    )
    assert manifest["pitcher_pitch_no"]["is_derived"]
    assert manifest["times_through_order"]["is_derived"]
    assert not manifest["plate_x"]["is_derived"]


def test_zone_route_shape(client: FlaskClient) -> None:
    batter = get_json(client, "/batters?dataset=padres_july2024")["batters"][0]["bam_id"]
    cells = get_json(client, f"/zone?dataset=padres_july2024&batter={batter}")["cells"]
    assert len(cells) == 18  # 6 regions x 3 strike buckets, empty cells included
    for cell in cells:
        if cell["pitches"] == 0:
            assert cell["swing_rate"] is None
        else:
            sr = cell["swing_rate"]
            assert sr["lo"] <= sr["estimate"] <= sr["hi"]
            assert sr["n"] == cell["pitches"]
    tto_cells = get_json(client, f"/zone?dataset=padres_july2024&batter={batter}&tto=1")["cells"]
    assert sum(c["pitches"] for c in tto_cells) < sum(c["pitches"] for c in cells)


def test_rates_route_carries_intervals_and_ns(client: FlaskClient) -> None:
    batter = get_json(client, "/batters?dataset=padres_july2024")["batters"][0]["bam_id"]
    body = get_json(client, f"/rates?dataset=padres_july2024&batter={batter}")
    assert set(body["rates"]) == {"chase", "whiff", "in_zone_swing", "hard_hit", "bat_speed"}
    for value in body["rates"].values():
        assert value["lo"] <= value["estimate"] <= value["hi"]
        assert value["n"] > 0
    assert body["baselines"] == {}  # empty baseline: estimates and intervals, no markers
    assert body["reference"] is None


def test_overview_route_matches_batters_and_rates(client: FlaskClient) -> None:
    batters = get_json(client, "/batters?dataset=padres_july2024")["batters"]
    rows = get_json(client, "/overview?dataset=padres_july2024")["batters"]
    assert [r["bam_id"] for r in rows] == [b["bam_id"] for b in batters]
    first = rows[0]
    # same computation as /rates: the overview is that route, per batter
    expected = get_json(client, f"/rates?dataset=padres_july2024&batter={first['bam_id']}")
    assert first["rates"] == expected["rates"]
    assert first["swings"] >= 100


def test_pitches_route_is_in_order_with_buckets(client: FlaskClient) -> None:
    batter = get_json(client, "/batters?dataset=padres_july2024")["batters"][0]["bam_id"]
    pitches = get_json(client, f"/pitches?dataset=padres_july2024&batter={batter}")["pitches"]
    keys = [(p["game_date"], p["at_bat_number"], p["pitch_seq"]) for p in pitches]
    assert keys == sorted(keys)
    assert all(p["strike_bucket"] == min(p["strikes"], 2) for p in pitches)
    assert all(p["region"] is None or isinstance(p["batter_relative_x_ft"], float) for p in pitches)


def test_pitches_route_carries_per_pitch_swing_and_bat_speed(client: FlaskClient) -> None:
    """The zone panel describes a single pitch from these, not a cell average."""
    batter = get_json(client, "/batters?dataset=padres_july2024")["batters"][0]["bam_id"]
    pitches = get_json(client, f"/pitches?dataset=padres_july2024&batter={batter}")["pitches"]
    assert all(isinstance(p["swing"], bool) for p in pitches)
    assert all(p["bat_speed"] is None or isinstance(p["bat_speed"], float) for p in pitches)
    # A take can carry no bat speed, so only swings are expected to measure one.
    assert any(p["bat_speed"] is not None for p in pitches if p["swing"])
