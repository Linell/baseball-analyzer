"""/trajectories packs nine reconstruction inputs per pitch as float32."""

import json
import math
import struct
from typing import Any

import pytest
from flask.testing import FlaskClient

from baseball_analyzer.api import TRAJECTORY_LAYOUT
from baseball_analyzer.db import Conn

pytestmark = pytest.mark.db


def fetch(client: FlaskClient, dataset: str) -> tuple[dict[str, Any], list[float]]:
    response = client.get(f"/trajectories?dataset={dataset}")
    assert response.status_code == 200
    assert response.mimetype == "application/octet-stream"
    body = response.data
    (header_len,) = struct.unpack_from("<I", body, 0)
    header = json.loads(body[4 : 4 + header_len])
    float_bytes = body[4 + header_len :]
    assert len(float_bytes) == header["count"] * header["stride"] * 4
    floats = list(struct.unpack(f"<{header['count'] * header['stride']}f", float_bytes))
    return header, floats


def test_shape_and_dataset_scope(client: FlaskClient, conn: Conn) -> None:
    """With the file loaded twice, one dataset's payload carries 6,431 rows, once."""
    header, floats = fetch(client, "padres_july2024")
    assert header["fields"] == TRAJECTORY_LAYOUT
    assert header["count"] == 6431  # every pitch row: no null path
    assert len(floats) == 6431 * len(TRAJECTORY_LAYOUT)
    second, _ = fetch(client, "second_copy")
    assert second["count"] == 6431


def test_rows_match_sql_and_codes_resolve(client: FlaskClient, conn: Conn) -> None:
    header, floats = fetch(client, "padres_july2024")
    stride = header["stride"]
    field = {name: i for i, name in enumerate(TRAJECTORY_LAYOUT)}

    first = floats[:stride]
    row = conn.execute(
        """
        select p.rel_speed, p.zone_time, p.batter_bam_id, p.pitch_type, p.batter_side,
               p.batter_team, p.pitcher_bam_id, p.pitcher_name_last, p.pitcher_side,
               p.pitcher_team
        from pitch p join dataset d on d.id = p.dataset_id
        where d.key = 'padres_july2024' and p.is_pitch
        order by p.game_date, p.game_bam_id, p.at_bat_number, p.pitch_seq
        limit 1
        """
    ).fetchone()
    assert row is not None
    assert first[field["rel_speed"]] == pytest.approx(row["rel_speed"], abs=1e-3)
    assert first[field["zone_time"]] == pytest.approx(row["zone_time"], abs=1e-5)
    batter = header["batters"][int(first[field["batter_index"]])]
    assert batter["bam_id"] == row["batter_bam_id"]
    assert batter["team"] == row["batter_team"]
    assert header["pitch_types"][int(first[field["pitch_type_index"]])] == row["pitch_type"]
    assert first[field["batter_side"]] == (0.0 if row["batter_side"] == "L" else 1.0)

    pitcher = header["pitchers"][int(first[field["pitcher_index"]])]
    assert pitcher["bam_id"] == row["pitcher_bam_id"]
    assert pitcher["last"] == row["pitcher_name_last"]
    assert pitcher["team"] == row["pitcher_team"]
    assert first[field["pitcher_side"]] == (0.0 if row["pitcher_side"] == "L" else 1.0)

    # The pickers split on this: the Padres are in all 22 games, no opponent
    # passes 3, so the rule that wants "the club the dataset is about" gets it.
    assert header["focus_team"] == "San Diego Padres"

    # Every arm the packed rows point at, listed once and densely indexed: the
    # showcase's pitcher picker is built straight from this table, and a
    # duplicate would split one pitcher across two entries. Compared against
    # the payload's own rows rather than a second query, so a dataset that
    # drops rows for a null flight path still compares like with like.
    ids = [p["bam_id"] for p in header["pitchers"]]
    referenced = {int(floats[i * stride + field["pitcher_index"]]) for i in range(header["count"])}
    assert len(ids) == len(set(ids)) == len(referenced) == max(referenced) + 1

    contacts = sum(
        1 for i in range(header["count"]) if not math.isnan(floats[i * stride + field["contact_x"]])
    )
    assert contacts == 2273  # every tracked contact (docs/DATA.md)
    for i in range(header["count"]):
        assert 0 <= int(floats[i * stride + field["outcome_index"]]) < len(header["outcomes"])


def test_unknown_dataset_404s(client: FlaskClient) -> None:
    assert client.get("/trajectories?dataset=nope").status_code == 404
    assert client.get("/trajectories").status_code == 400
