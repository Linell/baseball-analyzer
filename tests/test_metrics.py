from baseball_analyzer.metrics import Pitch, rate_card, zone_grid


def make_pitch(**overrides: object) -> Pitch:
    fields: dict[str, object] = {
        "plate_x": 0.0,
        "plate_z": 2.5,
        "strikezone_top": 3.4,
        "strikezone_bot": 1.6,
        "batter_side": "R",
        "pre_strikes": 0,
        "swing": False,
        "swinging_strike": False,
        "in_play": False,
        "bunt_attempt": False,
        "hit_exit_speed": None,
        "bat_speed": None,
    }
    fields.update(overrides)
    return Pitch(**fields)  # type: ignore[arg-type]


def test_bat_speed_excludes_bunts_but_counts_them_as_swings() -> None:
    pitches = [
        make_pitch(swing=True, bat_speed=70.0),
        make_pitch(swing=True, bat_speed=72.0),
        make_pitch(swing=True, bat_speed=15.1, bunt_attempt=True, swinging_strike=True),
    ]
    card = rate_card(pitches)
    bat_speed = card["bat_speed"]
    assert bat_speed is not None
    assert bat_speed.estimate == 71.0
    assert bat_speed.n == 2
    whiff = card["whiff"]
    assert whiff is not None
    assert whiff.n == 3  # the bunt is still a swing for whiff%


def test_zone_cell_bat_speed_carries_interval_or_nothing() -> None:
    # one measured swing in the heart: no interval is honest, so no figure
    cells = zone_grid([make_pitch(swing=True, bat_speed=61.7)])
    heart = next(c for c in cells if c.region == "heart" and c.strike_bucket == 0)
    assert heart.swings == 1
    assert heart.bat_speed is None
    # two measured swings: a mean with bounds and its n
    cells = zone_grid(
        [make_pitch(swing=True, bat_speed=68.0), make_pitch(swing=True, bat_speed=72.0)]
    )
    heart = next(c for c in cells if c.region == "heart" and c.strike_bucket == 0)
    assert heart.bat_speed is not None
    assert heart.bat_speed.lo < 70.0 < heart.bat_speed.hi
    assert heart.bat_speed.n == 2
