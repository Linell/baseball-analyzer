# Design

## Dataset model

A dataset is one CSV import: a pull for a single hitter, or a league-wide pull.
Datasets are first-class and never implicitly unioned. Every pitch row carries a
`dataset_id`; every query and every route is scoped to exactly one dataset and 404s
on an unknown key.

Four tables (`migrations/0001_initial.sql`):

- `pitch` — the pitches themselves: the CSV's columns typed, plus `dataset_id` and the
  two columns derived at ingest, `pitcher_pitch_no` and `times_through_order`.
- `dataset` — one row per import: key, name, source, date range, row count,
  `is_reference`. Reference datasets are league-wide pulls that feed `baseline`, so the
  hitter picker hides them.
- `dataset_column` — one row per column per dataset: `non_null_count`, `min_value`,
  `max_value`, `is_derived`. The counts let the frontend disable a view whose column is
  empty instead of drawing an empty axis. The ranges are the cheapest thing that
  catches a source shipping inches where we expect feet.
- `baseline` — percentile breakpoints (`p10` through `p90`) for a metric across the
  hitters in one reference dataset, with `n_players` and `n_events` recording the sample
  behind them. Keyed `(metric, split)`, though only `split = 'all'` exists today.
  Populated by
  `baseball-analyzer baselines --from <key>`, which calls the same `metrics.rate_card`
  that `/rates` serves; a test pins the equality. With the table empty, `/rates` returns
  estimates and intervals with no markers. `bat_speed` gets no baseline until its
  cross-source correlation is verified.

## Definitions

Metrics follow Savant's public definitions so the numbers are comparable off-screen.

| metric | definition |
|---|---|
| chase% | swings / pitches outside the rulebook zone |
| whiff% | swinging strikes / **swings** (not pitches) |
| in-zone swing% | swings / pitches in zone |
| hard-hit% | batted balls ≥ 95 mph / **batted balls** (balls in play only) |
| barrel | ≥ 98 mph, launch angle 26–30° widening ~1° per side per mph |

The zone is `|plate_x| ≤ 0.83 ∧ strikezone_bot ≤ plate_z ≤ strikezone_top`, with no
ball-radius buffer, asserted at ingest against the file's own `in_zone` column. The
strike bucket is `pre_strikes` clamped at 2, and is not stored. `is_barrel` is
implemented and unused; it waits for a screen that earns it rather than padding the
rate card.

The zone map's six regions are batter-relative:

- **heart** — the zone.
- Four **shadow/chase quadrants** — in/away and up/down, extending out to twice the
  zone. That band is about 3x wider than Savant's published shadow band (3.3 in
  horizontally, 4 in vertically from the zone edge), so per-region figures here do
  not reconcile with Savant's shadow/chase splits.
- **waste** — everything beyond.

## Computation

 Stats are computed once, in Python:

- `definitions.py` — pure per-pitch functions: the zone, the six regions, strike
  buckets, hard-hit, barrel. One zone function is applied to every source.
- `stats.py` — every rate carries its n and both bounds. The bounds are 95%
  Wilson: width comes from how few results there are, not just how mixed, so
  0-for-4 reads [.000, .490] where the textbook interval reads [.000, .000].
- `metrics.py` — the rate card and the zone grid. Baselines call these same
  functions, so a definition change moves both sides.

SQL does storage, scoping and the two ingest-time window functions; it computes no
statistics.

## Routes

| route | returns |
|---|---|
| `GET /datasets` | keys, ranges, row counts, manifest |
| `GET /batters?dataset=` | batters with ≥ 100 swings |
| `GET /overview?dataset=` | every qualifying batter's rate card, for the landing page |
| `GET /zone?dataset=&batter=[&tto=1]` | region × strike-bucket cells with rates, bounds, n |
| `GET /rates?dataset=&batter=` | rate card figures plus any baseline rows |
| `GET /pitches?dataset=&batter=` | the pitch list's rows, in pitch order |
| `GET /trajectories?dataset=` | nine reconstruction inputs per pitch plus batter/type/count/outcome codes, packed for a `Float32Array` |

`/trajectories` is binary: a header length, a JSON header
(count, stride, field names, and the code tables the per-pitch indexes point
into), then `count × stride` float values. The layout is `TRAJECTORY_LAYOUT`
in `api.py`; the client asserts on the header's field names, never on offsets.
Rows are pitches with all nine inputs non-null: all 6,431 on `padres_july2024`,
zero on an exported Savant dataset, which is the showcase's disabled state.

## Frontend

Vite + TypeScript + D3, no framework. One immutable `state` object, replaced rather
than mutated; each view re-reads and redraws. A request token guards every fetch so
a stale response can never land over a newer pick. The landing page is a sortable
batter overview; picking a hitter opens the analysis screen, which is the zone
decision map (three plate diagrams, one per strike bucket), the rate card and the
pitch list.

### Flight showcase

`web/src/flight/` — no imports across the boundary with `views/`. Loaded lazily so
three.js stays out of the analysis bundle. The screen carries no computed numbers:
geometry, and a detail card of raw values. It runs on `padres_july2024` only and
disables itself elsewhere, because Savant carries none of `zone_time`, `rel_angle`
or `rel_direction`.

- `trajectory.ts` — the pure reconstruction, no import from the renderer. Release
  point from `rel_side`/`extension`/`rel_height`, initial velocity from
  `rel_speed`/`rel_angle`/`rel_direction`. Acceleration is the only unknown left:
  hold it constant and `p(t) = p0 + v0 t + ½ a t²` has exactly one `a` that
  reaches `(plate_x, 1.417, plate_z)` at `zone_time` — three equations, three
  unknowns, closed form, no fitting. That single `a` carries gravity, drag and
  Magnus together. `zone_time` and not `plate_time`, because `plate_time` runs to
  the plate tip at y = 0 while `plate_x` and `plate_z` are measured at y = 1.417.
  Real drag eases as the ball slows, so a constant `a` is an approximation; the
  test suite measures that error rather than assuming it away
  (`web/tests/trajectory.test.ts`, in Node over the real file): reconstructed
  speed vs `zone_speed` (median 0.84 mph, p95 < 3), four-seam vertical
  acceleration above curveball, and the `plate_time` substitution case.
- `scene.ts` — three.js. All curves upload once as instanced geometry
  (30 segments each); animation runs in the vertex shader off one clock
  uniform and a per-instance release stagger, so playback costs one uniform
  write per frame. Filtering rewrites a per-instance visibility attribute;
  geometry is never rebuilt. Wireframe zone at the y = 1.417 measurement
  plane, depth fog, color by pitch type. Swing trajectories terminate at the
  time their flight reaches the measured contact point's depth, so the
  contact cloud is the set of endpoints; clicking raycasts those 2,273 points,
  never the curves.
- `showcase.ts` — filters (hitter, pitch type, strike bucket, stance), camera
  presets plus free orbit, play/pause/speed, and a scrubber through one
  hitter's swings in game order that freezes at contact with a detail card of
  raw values. The screen keeps local state and caches its mount per dataset:
  the global store redraws by rebuilding DOM, which would destroy the WebGL
  context.
- `sideView.ts` — region selection is a 2D brush on a linked side elevation,
  not a 3D lasso.

Pitch-type colors are the dark-mode categorical slots of the app palette,
assigned in frequency order and validated against the canvas surface; the
ninth type folds to muted gray, per the palette's series cap.

## Decisions

**`swing_path_tilt` is not `vertical_bat_angle`.** MLB's glossary distinguishes
them: tilt is the plane of the whole swing, attack angle is instantaneous at
contact, and VBA is the barrel's spatial tilt at contact. No source equates tilt and
VBA, and the two columns in this file measure different things.

**The baseline is computed, not published constants.** "He chases a lot" needs a
league number to mean anything, and we compute our own rather than copy Savant's:
their chase% uses their zone, so on exactly the figures a reference helps most,
theirs and ours aren't measuring the same thing. It is computed once and stored,
not a live `percentile_cont` over hundreds of thousands of rows per render, which
would make a league dataset a runtime dependency. The window is July 2024 — the
same month, parks and tracking era the subject faces — named on screen, with
`source_dataset_id` and `computed_at` on every row.

## References

- Statcast CSV columns: <https://baseballsavant.mlb.com/csv-docs>
- Statcast swing-path metrics: <https://www.mlb.com/glossary/statcast/swing-path-tilt>
