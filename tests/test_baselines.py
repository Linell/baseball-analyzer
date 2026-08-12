"""The metric feeding baseline and the figure /rates returns are the same
function (docs/DESIGN.md, Dataset model)."""

import statistics

import pytest
from flask.testing import FlaskClient

from baseball_analyzer.baselines import BASELINE_METRICS, compute_baselines
from baseball_analyzer.db import Conn
from tests.conftest import get_json

pytestmark = pytest.mark.db


def test_baselines_and_rates_agree(conn: Conn, client: FlaskClient) -> None:
    try:
        figures = compute_baselines(conn, "padres_july2024")
        conn.commit()
        assert figures == 4 * 7  # four metrics, seven qualifying hitters

        batters = get_json(client, "/batters?dataset=padres_july2024")["batters"]
        assert isinstance(batters, list)
        rates_by_batter = [
            get_json(client, f"/rates?dataset=padres_july2024&batter={b['bam_id']}")
            for b in batters
        ]

        body = rates_by_batter[0]
        baselines = body["baselines"]
        assert isinstance(baselines, dict)
        assert set(baselines) == set(BASELINE_METRICS)

        # the flagship equality: /rates figures are the values behind p50
        for metric in BASELINE_METRICS:
            estimates = [r["rates"][metric]["estimate"] for r in rates_by_batter]
            assert baselines[metric]["p50"] == pytest.approx(statistics.median(estimates))
            assert baselines[metric]["n_players"] == 7
            deciles = [baselines[metric][p] for p in ("p10", "p25", "p50", "p75", "p90")]
            assert deciles == sorted(deciles)

        assert "bat_speed" not in baselines  # no baseline until correlation verified
        reference = body["reference"]
        assert isinstance(reference, dict)
        assert reference["key"] == "padres_july2024"
    finally:
        conn.execute("delete from baseline")
        conn.commit()
