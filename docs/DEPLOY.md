# Deploy

One droplet (`165.22.184.78`, Ubuntu 24.04, 1 vCPU, 961 MB RAM + 2 GB swap), shared
with two other apps behind the host's Caddy. GitHub Actions builds the image on every
push to main and pushes `latest` + the commit SHA to public GHCR
(`ghcr.io/linell/baseball-analyzer`); the droplet only pulls — nothing is built there,
deliberately, because of the single vCPU. Two containers: `db` (postgres:17) and `app`
(gunicorn serving the API and the Vite bundle from one origin). Host Caddy terminates
TLS for `baseball-analyzer.thelinell.com` → `127.0.0.1:8001`.

Note dockerd itself costs ~150–200 MB on a 961 MB box; the `mem_limit`s in
`deploy/compose.yml` account for it.

## First-time server setup, in order

1. **Install Docker** (engine + compose plugin) from Docker's apt repo.
2. **Log rotation before the first container exists** — write `/etc/docker/daemon.json`:

   ```json
   {"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}
   ```

   then `systemctl restart docker`. The per-service `logging:` blocks in compose
   duplicate this so it is visible in the repo; the daemon default covers anything
   run outside compose. The disk is shared with the neighbors.
3. **Secrets** — `/etc/baseball-analyzer/env`, mode 0600:

   ```sh
   mkdir -p /etc/baseball-analyzer
   echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > /etc/baseball-analyzer/env
   chmod 600 /etc/baseball-analyzer/env
   ```

4. **Compose file** — `mkdir -p /srv/baseball-analyzer` and copy `deploy/compose.yml`
   there (deploy.sh does this on every run).
5. **DNS** — Cloudflare A record `baseball-analyzer` → `165.22.184.78` with the proxy
   **off** (grey cloud), or Caddy's HTTP-01 challenge fails. Confirm
   `dig +short baseball-analyzer.thelinell.com` returns the droplet IP — not a
   Cloudflare IP — before touching Caddy; reloading early burns Let's Encrypt
   failure-rate budget.
6. **Caddy** — back up `/etc/caddy/Caddyfile`, append the block in `deploy/Caddyfile`
   (no conf.d on this box; the existing apps are appended blocks too), then

   ```sh
   caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   systemctl reload caddy
   ```

   **Never `systemctl restart caddy`** — a parse error would drop voodoo and anchor.
7. **Deploy** — copy `deploy/.env.example` to `deploy/.env`, fill in host and key, then
   `deploy/deploy.sh` (or `make deploy`). Pass a commit SHA to roll back:
   `deploy/deploy.sh <sha>`.

## GHCR visibility

The first workflow run creates the `baseball-analyzer` package **private**. Make it
public once, by hand: github.com → profile → Packages → baseball-analyzer → Package
settings → Change visibility. Until then the droplet's anonymous `docker compose pull`
gets 401s.

## Operations

- The entrypoint runs `migrate` then `ingest csv --if-missing` on every start, so a
  fresh volume seeds itself and a seeded one boots in seconds.
- **No backups, by design**: the database is reproducible from the committed CSV.
- Recovery from a future Postgres major bump (17 → 18 would refuse the old data
  directory): `docker compose --env-file /etc/baseball-analyzer/env down -v && ... up -d`
  — the volume is disposable, see above.
- Logs: `docker compose logs`, capped at 3 × 10 MB per service.
