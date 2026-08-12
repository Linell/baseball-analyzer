# Baseball Analyzer

Three screens over one CSV of pitch-level data: 6,554 rows from 22 Padres games
in July 2024, 6,431 of them pitches.

- **Overview.** Every qualifying hitter, sortable on the rate card.
- **Analysis.** Where a hitter gives away at-bats by strike count: three zone
  maps, a rate card with intervals and league bands, a linked pitch list.
- **Showcase.** All 6,431 pitch flights in 3D, reconstructed from release and
  plate measurements.

Postgres, Flask, TypeScript (Vite, D3, three.js), no framework. Every statistic
is computed once in Python and carries its n and its interval.

## Running it

```sh
make setup      # python deps (uv) and web deps (npm)
make db-up      # postgres 17 in docker, port 5433
make migrate
make ingest     # data/source_data.csv as dataset padres_july2024
make api        # flask on :8000
make web        # vite dev server, proxies to the api
```

`make check` runs ruff, mypy --strict and pytest. `cd web && npm test` runs vitest.

## Docs

[docs/DESIGN.md](docs/DESIGN.md) covers the schema, the metric definitions, the routes, and some decisions made.
[docs/DATA.md](docs/DATA.md) covers the source file's coordinate conventions and known defects.
