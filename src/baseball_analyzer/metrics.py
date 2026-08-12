"""Aggregations over pitch rows."""

from collections.abc import Sequence
from dataclasses import dataclass

from baseball_analyzer.definitions import (
    REGIONS,
    STRIKE_BUCKETS,
    Region,
    in_zone,
    is_hard_hit,
    region,
    strike_bucket,
)
from baseball_analyzer.stats import Mean, Rate, mean, rate

SWING_THRESHOLD = 100

RATE_CARD_METRICS = ("chase", "whiff", "in_zone_swing", "hard_hit", "bat_speed")


@dataclass(frozen=True)
class Pitch:
    """The fields metrics need, one row per pitch (is_pitch rows only)."""

    plate_x: float | None
    plate_z: float | None
    strikezone_top: float | None
    strikezone_bot: float | None
    batter_side: str
    pre_strikes: int
    swing: bool
    swinging_strike: bool
    in_play: bool
    bunt_attempt: bool
    hit_exit_speed: float | None
    bat_speed: float | None

    def located(self) -> bool:
        return None not in (self.plate_x, self.plate_z, self.strikezone_top, self.strikezone_bot)

    def in_zone(self) -> bool:
        assert self.plate_x is not None and self.plate_z is not None
        assert self.strikezone_top is not None and self.strikezone_bot is not None
        return in_zone(self.plate_x, self.plate_z, self.strikezone_top, self.strikezone_bot)

    def region(self) -> Region:
        assert self.plate_x is not None and self.plate_z is not None
        assert self.strikezone_top is not None and self.strikezone_bot is not None
        return region(
            self.plate_x, self.plate_z, self.strikezone_top, self.strikezone_bot, self.batter_side
        )


def bat_speed_values(swings: Sequence[Pitch]) -> list[float]:
    """Bat speeds worth averaging: bunts are excluded, check swings are not.

    A bunt reads 9-23 mph and is not a swing decision; leaving them in biases
    chase-region means down by up to 10 mph (according to Claude). Check swings stay
    in because no measured column separates them without inventing a cutoff.
    """
    return [p.bat_speed for p in swings if p.bat_speed is not None and not p.bunt_attempt]


def rate_card(pitches: Sequence[Pitch]) -> dict[str, Rate | Mean | None]:
    """Chase%, whiff%, in-zone swing%, hard-hit%, mean bat speed.

    Only chase and in-zone swing need plate location; whiff, hard-hit and
    bat speed deliberately run over all pitches, located or not.
    """
    located = [p for p in pitches if p.located()]
    out_of_zone = [p for p in located if not p.in_zone()]
    in_the_zone = [p for p in located if p.in_zone()]
    swings = [p for p in pitches if p.swing]
    exit_speeds = [p.hit_exit_speed for p in pitches if p.in_play and p.hit_exit_speed is not None]
    return {
        "chase": rate(sum(p.swing for p in out_of_zone), len(out_of_zone)),
        "whiff": rate(sum(p.swinging_strike for p in swings), len(swings)),
        "in_zone_swing": rate(sum(p.swing for p in in_the_zone), len(in_the_zone)),
        "hard_hit": rate(sum(is_hard_hit(v) for v in exit_speeds), len(exit_speeds)),
        "bat_speed": mean(bat_speed_values(swings)),
    }


@dataclass(frozen=True)
class ZoneCell:
    region: Region
    strike_bucket: int
    pitches: int
    swings: int
    whiffs: int
    bat_speed: Mean | None
    swing_rate: Rate | None
    whiff_rate: Rate | None


def zone_grid(pitches: Sequence[Pitch]) -> list[ZoneCell]:
    """One cell per region x strike bucket, empty cells included."""
    groups: dict[tuple[Region, int], list[Pitch]] = {
        (r, b): [] for r in REGIONS for b in STRIKE_BUCKETS
    }
    for p in pitches:
        if p.located():
            groups[(p.region(), strike_bucket(p.pre_strikes))].append(p)
    cells = []
    for (reg, bucket), group in groups.items():
        swings = [p for p in group if p.swing]
        cells.append(
            ZoneCell(
                region=reg,
                strike_bucket=bucket,
                pitches=len(group),
                swings=len(swings),
                whiffs=sum(p.swinging_strike for p in swings),
                bat_speed=mean(bat_speed_values(swings)),
                swing_rate=rate(len(swings), len(group)),
                whiff_rate=rate(sum(p.swinging_strike for p in swings), len(swings)),
            )
        )
    return cells
