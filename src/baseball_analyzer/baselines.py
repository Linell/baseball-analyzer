"""League baselines: how is each metric distributed over hitters?

Calls the same metrics.rate_card that /rates serves, so a definition change
moves both sides at once. bat_speed gets no baseline until its cross-source
correlation is verified (docs/DESIGN.md, Dataset model).
"""

from baseball_analyzer import store
from baseball_analyzer.db import Conn
from baseball_analyzer.metrics import rate_card
from baseball_analyzer.stats import percentile

BASELINE_METRICS = ("chase", "whiff", "in_zone_swing", "hard_hit")


def compute_baselines(conn: Conn, dataset_key: str) -> int:
    """Replace all baseline rows from one dataset's qualifying hitters."""
    dataset = store.get_dataset(conn, dataset_key)
    if dataset is None:
        raise ValueError(f"unknown dataset {dataset_key!r}")

    per_metric: dict[str, list[tuple[float, int]]] = {m: [] for m in BASELINE_METRICS}
    for batter in store.list_batters(conn, dataset.id):
        rows = store.batter_pitch_rows(conn, dataset.id, batter.bam_id)
        card = rate_card([store.to_pitch(r) for r in rows])
        for metric in BASELINE_METRICS:
            figure = card[metric]
            if figure is not None:
                per_metric[metric].append((figure.estimate, figure.n))

    conn.execute("delete from baseline")
    for metric, values in per_metric.items():
        if not values:
            continue
        estimates = sorted(estimate for estimate, _ in values)
        conn.execute(
            """
            insert into baseline
                (metric, split, n_players, n_events, p10, p25, p50, p75, p90,
                 source_dataset_id)
            values (%s, 'all', %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                metric,
                len(values),
                sum(n for _, n in values),
                percentile(estimates, 0.10),
                percentile(estimates, 0.25),
                percentile(estimates, 0.50),
                percentile(estimates, 0.75),
                percentile(estimates, 0.90),
                dataset.id,
            ),
        )
    return sum(len(values) for values in per_metric.values())
