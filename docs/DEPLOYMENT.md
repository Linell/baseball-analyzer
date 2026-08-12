# Deployment

The app is live at <https://baseball-analyzer.thelinell.com>.

Every push to main runs a GitHub Actions workflow
(`.github/workflows/publish.yml`) that builds the Docker image and publishes it
to public GHCR, tagged `latest` and with the commit SHA. The server pulls that
image and runs `deploy/compose.yml`: Postgres and a gunicorn app serving the
API and the built frontend, behind Caddy for TLS. On start the app applies
migrations and, if the dataset is absent, seeds it from the committed CSV.

`deploy/deploy.sh` ships a new version; give it a commit SHA to roll back.
Secrets live in an env file on the server, outside the repo. There are no
database backups; the data reloads from `data/source_data.csv`.
