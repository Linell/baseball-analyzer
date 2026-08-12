"""Flask routes. Thin: resolve the dataset, fetch rows, aggregate, shape JSON.

Every route takes a required `dataset` and 404s on an unknown key.
"""

import json
import os
import struct
from dataclasses import asdict
from pathlib import Path

from flask import Flask, Response, abort, g, jsonify, request
from werkzeug.exceptions import HTTPException

from baseball_analyzer import db, store
from baseball_analyzer.definitions import batter_relative_x, strike_bucket
from baseball_analyzer.metrics import rate_card, zone_grid
from baseball_analyzer.stats import Mean, Rate

# Flask resolves a relative static_folder against root_path (this package
# directory), not the cwd, so it must be absolute — same derivation as
# db.MIGRATIONS_DIR. STATIC_DIR overrides it where the bundle lives elsewhere.
STATIC_DIR = Path(os.environ.get("STATIC_DIR") or Path(__file__).parents[2] / "web" / "dist")

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


def _conn() -> db.Conn:
    if "conn" not in g:
        g.conn = db.connect()
    return g.conn  # type: ignore[no-any-return]


@app.teardown_appcontext
def _close_conn(_exc: BaseException | None) -> None:
    conn = g.pop("conn", None)
    if conn is not None:
        conn.close()


def _dataset() -> store.Dataset:
    key = request.args.get("dataset") or abort(400, "dataset is required")
    return store.get_dataset(_conn(), key) or abort(404, f"unknown dataset {key!r}")


def _batter() -> int:
    try:
        return int(request.args["batter"])
    except (KeyError, ValueError):
        abort(400, "batter is required and must be a bam id")


def _interval(value: Rate | Mean | None) -> dict[str, float | int] | None:
    return asdict(value) if value else None


@app.errorhandler(HTTPException)
def _json_error(exc: HTTPException) -> tuple[Response, int]:
    return jsonify(error=exc.description), exc.code or 500


@app.get("/healthz")
def healthz() -> Response:
    """Liveness only — no database touch, so a slow Postgres cannot fail it."""
    return jsonify(status="ok")


@app.get("/")
def index() -> Response:
    return app.send_static_file("index.html")


@app.get("/datasets")
def datasets() -> Response:
    rows = store.list_datasets(_conn())
    return jsonify(
        datasets=[
            {
                "key": d.key,
                "name": d.name,
                "source": d.source,
                "start_date": d.start_date.isoformat() if d.start_date else None,
                "end_date": d.end_date.isoformat() if d.end_date else None,
                "row_count": d.row_count,
                "is_reference": d.is_reference,
                "columns": [asdict(c) for c in d.columns],
            }
            for d in rows
        ]
    )


@app.get("/batters")
def batters() -> Response:
    dataset = _dataset()
    if dataset.is_reference:
        abort(404, "reference datasets stay out of the hitter picker")
    rows = store.list_batters(_conn(), dataset.id)
    return jsonify(
        batters=[
            {
                "bam_id": b.bam_id,
                "name": f"{b.name_first} {b.name_last}",
                "sides": b.sides,
                "pitches": b.pitches,
                "swings": b.swings,
            }
            for b in rows
        ]
    )


@app.get("/overview")
def overview() -> Response:
    """Every qualifying batter's rate card, for the dataset-level landing page."""
    dataset = _dataset()
    if dataset.is_reference:
        abort(404, "reference datasets stay out of the hitter picker")
    conn = _conn()
    rows = []
    for b in store.list_batters(conn, dataset.id):
        card = rate_card(
            [store.to_pitch(r) for r in store.batter_pitch_rows(conn, dataset.id, b.bam_id)]
        )
        rows.append(
            {
                "bam_id": b.bam_id,
                "name": f"{b.name_first} {b.name_last}",
                "sides": b.sides,
                "pitches": b.pitches,
                "swings": b.swings,
                "rates": {name: _interval(value) for name, value in card.items()},
            }
        )
    return jsonify(batters=rows)


@app.get("/zone")
def zone() -> Response:
    dataset = _dataset()
    first_tto = request.args.get("tto") == "1"
    rows = store.batter_pitch_rows(_conn(), dataset.id, _batter(), first_tto)
    cells = zone_grid([store.to_pitch(r) for r in rows])
    return jsonify(
        cells=[
            {
                "region": c.region,
                "strike_bucket": c.strike_bucket,
                "pitches": c.pitches,
                "swings": c.swings,
                "whiffs": c.whiffs,
                "bat_speed": _interval(c.bat_speed),
                "swing_rate": _interval(c.swing_rate),
                "whiff_rate": _interval(c.whiff_rate),
            }
            for c in cells
        ]
    )


@app.get("/rates")
def rates() -> Response:
    dataset = _dataset()
    rows = store.batter_pitch_rows(_conn(), dataset.id, _batter())
    card = rate_card([store.to_pitch(r) for r in rows])
    baseline_rows = store.list_baselines(_conn())
    baselines = {
        b.metric: {
            "p10": b.p10,
            "p25": b.p25,
            "p50": b.p50,
            "p75": b.p75,
            "p90": b.p90,
            "n_players": b.n_players,
            "n_events": b.n_events,
        }
        for b in baseline_rows
        if b.split == "all"
    }
    reference = next(
        (
            {
                "key": b.source_key,
                "name": b.source_name,
                "start_date": b.source_start.isoformat() if b.source_start else None,
                "end_date": b.source_end.isoformat() if b.source_end else None,
            }
            for b in baseline_rows
        ),
        None,
    )
    return jsonify(
        rates={name: _interval(value) for name, value in card.items()},
        baselines=baselines,
        reference=reference,
    )


# One float32 record per pitch, in game order. The layout is fixed and the
# header names it, so the client asserts on field names rather than offsets.
TRAJECTORY_LAYOUT = [
    "rel_side",
    "extension",
    "rel_height",
    "rel_speed",
    "rel_angle",
    "rel_direction",
    "plate_x",
    "plate_z",
    "zone_time",
    "pitch_id",
    "batter_index",
    "batter_side",  # 0 = L, 1 = R, NaN = unrecorded
    "pitcher_index",
    "pitcher_side",  # the throws half of the matchup, same encoding
    "pitch_type_index",
    "balls",
    "strikes",
    "outcome_index",
    "swing",  # 0 / 1
    "contact_x",  # NaN when untracked
    "contact_y",
    "contact_z",
    "sz_top",
    "sz_bot",
]

_NAN = float("nan")


def _f(value: float | int | None) -> float:
    return _NAN if value is None else float(value)


def _side(value: str | None) -> float:
    """0 = L, 1 = R, NaN = unrecorded.

    `pitcher_side` is nullable where `batter_side` is `not null`, and folding a
    null into the else branch would draw an unknown arm as right-handed and
    leave it unfilterable by the throws chips.
    """
    if value is None:
        return _NAN
    return 0.0 if value == "L" else 1.0


@app.get("/trajectories")
def trajectories() -> Response:
    """Reconstruction inputs for every pitch, packed for a Float32Array.

    Body: uint32 little-endian header length, a UTF-8 JSON header (count,
    stride, fields, and the code tables the float indexes point into), then
    count x stride float32 values.
    """
    dataset = _dataset()
    rows = store.trajectory_rows(_conn(), dataset.id)

    batters: list[dict[str, int | str | None]] = []  # built in the header's shape directly
    batter_index: dict[int, int] = {}
    pitchers: list[dict[str, int | str | None]] = []
    pitcher_index: dict[int, int] = {}
    types: list[str] = []
    type_index: dict[str, int] = {}
    outcomes: list[str] = []
    outcome_index: dict[str, int] = {}

    def index_of(value: str, table: list[str], lookup: dict[str, int]) -> int:
        if value not in lookup:
            lookup[value] = len(table)
            table.append(value)
        return lookup[value]

    def player_index(
        bam_id: int,
        first: str | None,
        last: str | None,
        team: str | None,
        table: list[dict[str, int | str | None]],
        lookup: dict[int, int],
    ) -> int:
        if bam_id not in lookup:
            lookup[bam_id] = len(table)
            name = f"{first or ''} {last or ''}".strip() or str(bam_id)
            # `last` separately: the client sorts its pickers by surname, and
            # splitting the display name back apart guesses wrong on two-word
            # surnames. Both name columns are nullable, so it falls back to the
            # display name rather than sorting a blank above every real name.
            # `team` is first-seen: no one changes clubs inside one import, and
            # the pickers only compare it to the header's focus team.
            table.append(
                {
                    "bam_id": bam_id,
                    "name": name,
                    "last": (last or "").strip() or name,
                    "team": team,
                }
            )
        return lookup[bam_id]

    values: list[float] = []
    for r in rows:
        values.extend(
            (
                r.rel_side,
                r.extension,
                r.rel_height,
                r.rel_speed,
                r.rel_angle,
                r.rel_direction,
                r.plate_x,
                r.plate_z,
                r.zone_time,
                float(r.id),
                float(
                    player_index(
                        r.batter_bam_id,
                        r.batter_name_first,
                        r.batter_name_last,
                        r.batter_team,
                        batters,
                        batter_index,
                    )
                ),
                _side(r.batter_side),
                float(
                    player_index(
                        r.pitcher_bam_id,
                        r.pitcher_name_first,
                        r.pitcher_name_last,
                        r.pitcher_team,
                        pitchers,
                        pitcher_index,
                    )
                ),
                _side(r.pitcher_side),
                float(index_of(r.pitch_type or "??", types, type_index)),
                float(r.pre_balls),
                float(r.pre_strikes),
                float(index_of(r.pitch_result or "?", outcomes, outcome_index)),
                1.0 if r.swing else 0.0,
                _f(r.hit_contact_x),
                _f(r.hit_contact_y),
                _f(r.hit_contact_z),
                _f(r.strikezone_top),
                _f(r.strikezone_bot),
            )
        )

    header = json.dumps(
        {
            "count": len(rows),
            "stride": len(TRAJECTORY_LAYOUT),
            "fields": TRAJECTORY_LAYOUT,
            "pitch_types": types,
            "outcomes": outcomes,
            "batters": batters,
            "pitchers": pitchers,
            "focus_team": store.focus_team(_conn(), dataset.id),
        }
    ).encode()
    body = struct.pack("<I", len(header)) + header + struct.pack(f"<{len(values)}f", *values)
    return Response(body, mimetype="application/octet-stream")


@app.get("/pitches")
def pitches() -> Response:
    dataset = _dataset()
    rows = store.batter_pitch_rows(_conn(), dataset.id, _batter())
    pitch_rows = []
    for r in rows:
        pitch = store.to_pitch(r)
        pitch_rows.append(
            {
                "id": r.id,
                "game_date": r.game_date.isoformat(),
                "at_bat_number": r.at_bat_number,
                "pitch_seq": r.pitch_seq,
                "balls": r.pre_balls,
                "strikes": r.pre_strikes,
                "strike_bucket": strike_bucket(r.pre_strikes),
                "pitcher_pitch_no": r.pitcher_pitch_no,
                "pitch_type": r.pitch_type,
                "pitch_result": r.pitch_result,
                # This pitch's own swing/bat speed, so the UI can describe one
                # pitch without falling back to its zone cell's aggregate.
                "swing": r.swing,
                "bat_speed": r.bat_speed,
                "region": pitch.region() if pitch.located() else None,
                # feet, positive toward the batter (docs/DATA.md)
                "batter_relative_x_ft": (
                    batter_relative_x(r.plate_x, r.batter_side) if r.plate_x is not None else None
                ),
                "plate_z": r.plate_z,
                "sz_top": r.strikezone_top,
                "sz_bot": r.strikezone_bot,
            }
        )
    return jsonify(pitches=pitch_rows)
