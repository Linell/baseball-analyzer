"""Per-pitch definitions, following Savant's public definitions (docs/DESIGN.md).

Everything here is a pure function of one pitch's numbers, shared by every
route and by baselines, so a definition change moves everything at once.
"""

from typing import Literal

ZONE_HALF_WIDTH = 0.83  # feet; reproduces the source file's in_zone at 100.0%
HARD_HIT_MPH = 95.0
Region = Literal["heart", "up_in", "up_away", "down_in", "down_away", "waste"]

REGIONS: tuple[Region, ...] = ("heart", "up_in", "up_away", "down_in", "down_away", "waste")
STRIKE_BUCKETS = (0, 1, 2)


def in_zone(plate_x: float, plate_z: float, sz_top: float, sz_bot: float) -> bool:
    """The rulebook zone, no ball-radius buffer."""
    return abs(plate_x) <= ZONE_HALF_WIDTH and sz_bot <= plate_z <= sz_top


def strike_bucket(pre_strikes: int) -> int:
    """0, 1, or 2 strikes; 3-2 counts map to two strikes."""
    return min(pre_strikes, 2)


def batter_relative_x(plate_x: float, batter_side: str) -> float:
    """plate_x with positive always toward the batter (inside).

    In this file positive plate_x is the catcher's left, the third-base
    side, where a right-handed batter stands (docs/DATA.md).
    """
    return plate_x if batter_side == "R" else -plate_x


def region(
    plate_x: float, plate_z: float, sz_top: float, sz_bot: float, batter_side: str
) -> Region:
    """heart is the zone; four batter-relative quadrants extend out to twice
    the zone in each direction; waste is everything beyond.

    The quadrant band is twice the zone (docs/DESIGN.md). It is about three
    times wider than Savant's published shadow band, so per-region figures
    will not reconcile with Savant's shadow/chase splits.
    """
    if in_zone(plate_x, plate_z, sz_top, sz_bot):
        return "heart"
    height = sz_top - sz_bot
    within_band = (
        abs(plate_x) <= 2 * ZONE_HALF_WIDTH
        and sz_bot - height / 2 <= plate_z <= sz_top + height / 2
    )
    if not within_band:
        return "waste"
    vertical = "up" if plate_z > (sz_top + sz_bot) / 2 else "down"
    horizontal = "in" if batter_relative_x(plate_x, batter_side) > 0 else "away"
    return f"{vertical}_{horizontal}"  # type: ignore[return-value]


# XXX: does 'callers pass batted balls only' have a corresponding test?
#   It may be smart to add some sort of check here?
def is_hard_hit(hit_exit_speed: float) -> bool:
    """Batted ball at 95+ mph. Callers pass batted balls only."""
    return hit_exit_speed >= HARD_HIT_MPH


def is_barrel(hit_exit_speed: float, hit_vertical_angle: float) -> bool:
    """98+ mph, launch angle 26-30 degrees widening 1 degree per side per mph."""
    if hit_exit_speed < 98.0:
        return False
    extra = hit_exit_speed - 98.0
    low = max(26.0 - extra, 8.0)
    high = min(30.0 + extra, 50.0)
    return low <= hit_vertical_angle <= high
