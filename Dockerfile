# The Vite bundle is architecture-independent, so the node stage runs on the
# build host's native platform while the runtime stage targets the droplet.
FROM --platform=$BUILDPLATFORM node:22-slim AS web
ENV NODE_OPTIONS=--max-old-space-size=1536
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.13-slim AS python-deps
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
# The project installs editable, so src/ must exist before the sync and the
# runtime stage must keep it at the same path. --locked fails loudly on lock
# drift; --no-dev keeps pytest (whose conftest drops databases) out of the image.
COPY src ./src
RUN uv sync --locked --no-dev --extra serve

FROM python:3.13-slim
WORKDIR /app
COPY --from=python-deps /app/.venv ./.venv
COPY src ./src
COPY migrations ./migrations
COPY data ./data
COPY --from=web /build/dist ./web/dist
COPY --chmod=755 deploy/entrypoint.sh ./entrypoint.sh
RUN useradd --system --no-create-home --uid 10001 app
USER app
# HOME on the tmpfs: the filesystem is read-only in compose and gunicorn's
# control socket wants somewhere writable under $HOME.
ENV PATH="/app/.venv/bin:$PATH" HOME=/tmp
EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
