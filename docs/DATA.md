# Data notes

## Source file

`data/source_data.csv`: 6,554 rows, 6,431 of them pitches (`is_pitch`); the rest are
pickoffs, step-offs and other non-pitch events. 22 Padres games circa July 2024.

### Coordinate conventions

- `plate_x` is in feet with **positive toward the catcher's left**, the third-base
  side, where a right-handed batter stands. This is the opposite sign of Savant's
  `plate_x`. Batter-relative "inside" is therefore `plate_x > 0` for right-handed
  batters and `plate_x < 0` for left-handed batters
  (`definitions.batter_relative_x`).
- `plate_z` is height in feet at the front of the zone. `strikezone_top` /
  `strikezone_bot` are per-pitch.
- The zone that reproduces the file's own `in_zone` column at 100.0% is
  `|plate_x| <= 0.83 and strikezone_bot <= plate_z <= strikezone_top`, with no
  ball-radius buffer. 0.82 and 0.84 both fail.
- `horizontal_bat_attack_angle` is already batter-relative and must not be mirrored.

### Known defects

- `pitcher_team_bam_id` holds `TRUE`/`FALSE`, not a team id. The column manifest's
  min/max (0/1) is what catches this class of error.
- `contact` disagrees with `swing and not swinging_strike` on 2 of 6,431 pitches
  (99.97%).

### Column families and their null rates

- Pitch tracking (`rel_*`, breaks, `zone_time`, `plate_x/z`): populated on all 6,431
  pitches.
- Batted ball (`hit_*`): 2,273 rows — every tracked contact, of which 1,122 are
  fouls and 1,152 are in play. Hard-hit% divides by the in-play subset only;
  dividing by all 2,273 would understate it by ~14 points.
- Bat tracking (`bat_speed`, `*_bat_angle`, `*_attack_angle`): 3,130 rows — swings,
  **including 24 bunts (9–23 mph) and ~100 sub-50-mph check/emergency swings**.
  Bat-speed means exclude bunts (`metrics.bat_speed_values`); check swings stay in
  because no measured column separates them without inventing a cutoff, so
  chase-region bat speeds still read low relative to a competitive-swing average.
  `vertical_bat_angle` and `vertical_bat_attack_angle` correlate at r = 0.133; they
  are different quantities (see DESIGN.md, Decisions).

## Derived columns

Computed at ingest over `is_pitch` rows only, marked `is_derived` in the manifest:

- `pitcher_pitch_no`: pitch number within a pitcher's appearance (max 114; starter
  appearances run 39–114, the 39 being a short injury start).
- `times_through_order`: batter's trip through the order vs that pitcher
  (splits 4,159 / 1,507 / 759 / 6 — a fourth trip exists).
