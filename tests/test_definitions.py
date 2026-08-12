"""The file's booleans are exactly derivable: a free test and the oracle."""

from baseball_analyzer.definitions import (
    batter_relative_x,
    in_zone,
    is_barrel,
    region,
    strike_bucket,
)


def derived_zone(row: dict[str, str]) -> bool:
    return in_zone(
        float(row["plate_x"]),
        float(row["plate_z"]),
        float(row["strikezone_top"]),
        float(row["strikezone_bot"]),
    )


def test_zone_reproduces_in_zone_exactly(pitch_rows: list[dict[str, str]]) -> None:
    assert len(pitch_rows) == 6431
    assert all(derived_zone(r) == (r["in_zone"] == "TRUE") for r in pitch_rows)


def test_neighboring_half_widths_do_not_match(pitch_rows: list[dict[str, str]]) -> None:
    for half_width in (0.82, 0.84):
        matches = sum(
            (
                abs(float(r["plate_x"])) <= half_width
                and float(r["strikezone_bot"]) <= float(r["plate_z"]) <= float(r["strikezone_top"])
            )
            == (r["in_zone"] == "TRUE")
            for r in pitch_rows
        )
        assert matches < len(pitch_rows)


def test_chase_reproduces_exactly(pitch_rows: list[dict[str, str]]) -> None:
    assert all(
        ((r["swing"] == "TRUE") and not derived_zone(r)) == (r["chase"] == "TRUE")
        for r in pitch_rows
    )


def test_contact_reproduces_at_9997(pitch_rows: list[dict[str, str]]) -> None:
    matches = sum(
        ((r["swing"] == "TRUE") and r["swinging_strike"] != "TRUE") == (r["contact"] == "TRUE")
        for r in pitch_rows
    )
    assert round(matches / len(pitch_rows), 4) == 0.9997


def test_all_twelve_counts_map_to_one_bucket() -> None:
    buckets = {
        (balls, strikes): strike_bucket(strikes) for balls in range(4) for strikes in range(3)
    }
    assert len(buckets) == 12
    assert set(buckets.values()) == {0, 1, 2}
    assert buckets[(3, 2)] == 2  # 3-2 maps to two strikes


def test_pooled_chase_by_bucket(pitch_rows: list[dict[str, str]]) -> None:
    out_of_zone = [r for r in pitch_rows if not derived_zone(r)]
    pooled = []
    for bucket in (0, 1, 2):
        rows = [r for r in out_of_zone if strike_bucket(int(r["pre_strikes"])) == bucket]
        pooled.append(round(100 * sum(r["swing"] == "TRUE" for r in rows) / len(rows), 1))
    assert pooled == [19.2, 31.9, 43.4]


def test_region_partition_is_batter_relative() -> None:
    sz_top, sz_bot = 3.4, 1.6
    assert region(0.0, 2.5, sz_top, sz_bot, "R") == "heart"
    # just off the plate, upper half: inside for a righty, away for a lefty
    assert region(1.0, 3.0, sz_top, sz_bot, "R") == "up_in"
    assert region(1.0, 3.0, sz_top, sz_bot, "L") == "up_away"
    assert region(-1.0, 1.0, sz_top, sz_bot, "R") == "down_away"
    assert region(-1.0, 1.0, sz_top, sz_bot, "L") == "down_in"
    # beyond twice the zone in either direction is waste
    assert region(1.7, 2.5, sz_top, sz_bot, "R") == "waste"
    assert region(0.0, 4.4, sz_top, sz_bot, "R") == "waste"


def test_batter_relative_x_mirrors_lefties() -> None:
    assert batter_relative_x(0.5, "R") == 0.5
    assert batter_relative_x(0.5, "L") == -0.5


def test_barrel_window_widens_with_exit_speed() -> None:
    assert not is_barrel(97.9, 28.0)
    assert is_barrel(98.0, 26.0) and is_barrel(98.0, 30.0)
    assert not is_barrel(98.0, 25.9) and not is_barrel(98.0, 30.1)
    assert is_barrel(103.0, 21.0) and is_barrel(103.0, 35.0)
    assert not is_barrel(103.0, 20.9)


def test_bat_tracking_angles_are_distinct_quantities(pitch_rows: list[dict[str, str]]) -> None:
    """vertical_bat_angle and vertical_bat_attack_angle correlate at r = 0.133."""
    pairs = [
        (float(r["vertical_bat_angle"]), float(r["vertical_bat_attack_angle"]))
        for r in pitch_rows
        if r["vertical_bat_angle"] and r["vertical_bat_attack_angle"]
    ]
    assert len(pairs) == 3130
    n = len(pairs)
    mean_a = sum(a for a, _ in pairs) / n
    mean_b = sum(b for _, b in pairs) / n
    cov = sum((a - mean_a) * (b - mean_b) for a, b in pairs)
    var_a = sum((a - mean_a) ** 2 for a, _ in pairs)
    var_b = sum((b - mean_b) ** 2 for _, b in pairs)
    r = cov / (var_a**0.5 * var_b**0.5)
    assert round(r, 3) == 0.133
