# Baseball Analyzer

- **Overview.** Every qualifying hitter, sortable on the rate card.
- **Analysis.** Where a hitter gives away at-bats by strike count: three zone
  maps, a rate card with intervals and league bands, a linked pitch list.
- **Showcase.** All 6,431 pitch flights in 3D, reconstructed from release and
  plate measurements.

Postgres, Flask, TypeScript (Vite, D3, three.js), no framework. Every statistic
is computed once in Python and carries its n and its interval.

## Getting Started

```sh
make setup      # python deps (uv) and web deps (npm)
make db-up      # postgres 17 in docker, port 5433
make migrate
make ingest     # data/source_data.csv as dataset padres_july2024
make api        # flask on :8000
make web        # vite dev server, proxies to the api
```

`make check` runs ruff, mypy --strict and pytest. `cd web && npm test` runs vitest.

## Methodology

I love how useful AI is, and it was used for vaguely *every* phase of this project. I used `duckdb` and good old fashioned poking around to get a basic understanding of the data, looking for interesting ways to use the data. After the purely exploratory phase I started writing a spec that would become `DESIGN.md` and `DATA.md`.

I chose to implement the idea of multiple datasets because I was planning on pulling in more league-wide data to help flesh the numbers out more. I haven't done that step yet, but the groundwork has been laid. The data structure in general is geared to this goal, with honestly a fair amount of plumbing that isn't entirely necessary without the increased scope of multiple datasets. The important table for this example is the `pitch` table, which just represents the provided data imported into PG.

The only "vibe coded" section is the showcase's actual hardcore rending bits (a la `scene.ts`), with the goal of the code still being readable enough that it's not slop.

## Docs

[docs/DESIGN.md](docs/DESIGN.md) covers the schema, the metric definitions, the routes, and some decisions made.
[docs/DATA.md](docs/DATA.md) covers the source file's coordinate conventions and known defects.
