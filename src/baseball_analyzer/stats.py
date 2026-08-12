"""Rates and intervals. Every figure carries its n and its interval."""

import math
from collections.abc import Sequence
from dataclasses import dataclass

Z_95 = 1.96

# How wide to draw the error bar on an average: this number times sd / sqrt(n).
# Look it up by sample size -- n = 2 takes the first entry, n = 31 the last, and
# anything bigger takes z = 1.96. Small samples get a large multiplier because sd
# measured from two or three values is a poor guess at the real spread, and the
# interval has to admit that. These are Student's t, two-sided 95%.
T_95 = (
    12.706,
    4.303,
    3.182,
    2.776,
    2.571,
    2.447,
    2.365,
    2.306,
    2.262,
    2.228,
    2.201,
    2.179,
    2.160,
    2.145,
    2.131,
    2.120,
    2.110,
    2.101,
    2.093,
    2.086,
    2.080,
    2.074,
    2.069,
    2.064,
    2.060,
    2.056,
    2.052,
    2.048,
    2.045,
    2.042,
)


@dataclass(frozen=True)
class Rate:
    estimate: float
    lo: float
    hi: float
    n: int


@dataclass(frozen=True)
class Mean:
    estimate: float
    lo: float
    hi: float
    n: int


def wilson_interval(successes: int, n: int, z: float = Z_95) -> tuple[float, float]:
    """Wilson score interval for a proportion. Requires n > 0."""
    p = successes / n
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    half = (z / denom) * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2))
    return center - half, center + half


def rate(successes: int, n: int) -> Rate | None:
    """A proportion with its Wilson bounds; None when n = 0.

    The bounds land in [0, 1] and bracket the estimate exactly; at p = 0 and
    p = 1 the closed form does too, but floating point drifts by ~1e-17.
    """
    if n == 0:
        return None
    p = successes / n
    lo, hi = wilson_interval(successes, n)
    return Rate(estimate=p, lo=min(max(lo, 0.0), p), hi=max(min(hi, 1.0), p), n=n)


def mean(values: Sequence[float]) -> Mean | None:
    """A mean with a t-based interval; None when n < 2.

    One observation carries no interval, and every figure must carry one,
    so n = 1 returns None rather than a zero-width claim of certainty.
    """
    n = len(values)
    if n < 2:
        return None
    m = sum(values) / n
    sd = math.sqrt(sum((v - m) ** 2 for v in values) / (n - 1))
    t = T_95[n - 2] if n - 1 <= len(T_95) else Z_95
    half = t * sd / math.sqrt(n)
    return Mean(estimate=m, lo=m - half, hi=m + half, n=n)


def percentile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile of pre-sorted values, q in [0, 1]."""
    if not sorted_values:
        raise ValueError("percentile of no values")
    position = q * (len(sorted_values) - 1)
    below = math.floor(position)
    above = min(below + 1, len(sorted_values) - 1)
    weight = position - below
    return sorted_values[below] * (1 - weight) + sorted_values[above] * weight
