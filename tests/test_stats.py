import pytest

from baseball_analyzer.stats import mean, percentile, rate, wilson_interval


def test_wilson_interval_pinned_by_hand() -> None:
    """40 of 100 at z = 1.96, worked by hand so the formula is checked."""
    lo, hi = wilson_interval(40, 100)
    assert lo == pytest.approx(0.309400, abs=1e-6)
    assert hi == pytest.approx(0.497999, abs=1e-6)


@pytest.mark.parametrize(("successes", "n"), [(0, 10), (3, 7), (10, 10), (1, 1000)])
def test_bounds_bracket_the_estimate(successes: int, n: int) -> None:
    result = rate(successes, n)
    assert result is not None
    assert result.lo <= result.estimate <= result.hi
    assert result.lo >= 0 and result.hi <= 1
    assert result.n == n


def test_zero_n_returns_none() -> None:
    assert rate(0, 0) is None
    assert mean([]) is None


def test_single_observation_has_no_interval() -> None:
    """A zero-width interval from one swing would be a claim of certainty."""
    assert mean([61.7]) is None


def test_mean_interval_uses_t_not_z() -> None:
    result = mean([70.0, 72.0, 74.0])
    assert result is not None
    assert result.lo < result.estimate == 72.0 < result.hi
    assert result.n == 3
    # at n = 3 (df = 2) the t half-width is 4.303/1.96 the z half-width
    z_half_width = 1.96 * 2.0 / 3**0.5
    assert (result.hi - result.estimate) == pytest.approx(z_half_width * 4.303 / 1.96, rel=1e-3)


def test_percentile_pinned() -> None:
    values = [1.0, 2.0, 3.0, 4.0]
    assert percentile(values, 0.50) == 2.5
    assert percentile(values, 0.25) == 1.75
    assert percentile(values, 0.0) == 1.0
    assert percentile(values, 1.0) == 4.0
