# Baseball Analyzer

Three screens over one CSV of pitch-level data (6,554 rows, 6,431 pitches, 22 Padres
games in July 2024): a sortable batter overview, a swing-decision analysis screen, and
a 3D showcase of every pitch flight. Postgres + Flask + TypeScript (Vite, D3, three.js),
no frontend framework.

Read [docs/DESIGN.md](docs/DESIGN.md) before changing anything in `src/` or `web/src/`.
It holds the schema, the metric definitions, the routes, the frontend state model, the
trajectory math, and the reasoning behind what is deliberately absent.
[docs/DATA.md](docs/DATA.md) holds the source file's coordinate conventions, null rates
and known defects. This is not a git repo, so there is no history to consult.

## Layout

| path | what |
|---|---|
| `src/baseball_analyzer/definitions.py` | pure per-pitch functions: zone, six regions, strike bucket, hard-hit, barrel |
| `src/baseball_analyzer/stats.py` | `Rate` / `Mean`, 95% Wilson bounds |
| `src/baseball_analyzer/metrics.py` | rate card and zone grid; baselines call these same functions |
| `src/baseball_analyzer/store.py` | all SQL |
| `src/baseball_analyzer/api.py` | Flask routes, thin |
| `src/baseball_analyzer/{ingest,baselines,db,cli}.py` | CSV load + manifest, baseline computation, connection/migrations, CLI |
| `migrations/*.sql` | applied in name order, tracked in `schema_migration`; never edit an applied one |
| `web/src/views/`, `web/src/flight/` | analysis screens (D3) and the showcase (three.js), with no imports across that boundary |
| `deploy/` | compose files, entrypoint, deploy script, Caddy block; see [docs/DEPLOY.md](docs/DEPLOY.md) |

## Verifying

```sh
make check            # ruff, mypy --strict, pytest; what CI runs
cd web && npm test    # vitest
cd web && npx tsc --noEmit
```

Verify with these rather than by driving the app in a browser. The db-marked tests skip
silently when Postgres is down, so run `make db-up` first; otherwise the suite passes
without touching the database. First-run setup and the dev servers are in README.md.

## Invariants

- **Statistics are computed in Python, once.** SQL does storage, dataset scoping and the
  two ingest-time window functions, and computes no statistics. Baselines and `/rates`
  both call `metrics.rate_card`, and a test pins the equality.
- **Every rate carries `n` and both bounds.** No function returns a bare float, and no
  view renders one without its interval and sample size.
- **Datasets are never implicitly unioned.** Every query and route is scoped to one
  `dataset_id` and 404s on an unknown key.
- **Denominators follow Savant.** Whiff% divides by swings, hard-hit% by balls in play
  (dividing by all 2,273 batted balls understates it by ~14 points), and bat-speed means
  exclude bunts.
- **`plate_x` is sign-flipped from Savant.** Positive is the third-base side, so use
  `definitions.batter_relative_x`. `horizontal_bat_attack_angle` is already
  batter-relative and must not be mirrored.
- **Frontend state is one immutable object,** replaced wholesale; views re-read and
  redraw. A request token guards every fetch so a stale response cannot land over a
  newer pick. The showcase caches its mount per dataset instead, because a rebuild
  would destroy the WebGL context.
- **`/trajectories` is a binary route.** The client asserts on the JSON header's field
  names, never on byte offsets. Change `TRAJECTORY_LAYOUT` in `api.py` and the header
  carries the change.

## Style

Python 3.13, `ruff` (line length 100, `ANN` on, so annotate everything) and
`mypy --strict`. TypeScript strict with `noUnusedLocals` and `noUnusedParameters`. SQL
keywords lowercase. Comments explain the reasoning that is not in the code; match the
density of the ones already there.

Before adding a metric or a view, check DESIGN.md's "Deliberately absent" list. Run
value from this file, statistics on the 3D contact point, a rendered bat path and
pitcher-facing views were each cut for a stated reason.
