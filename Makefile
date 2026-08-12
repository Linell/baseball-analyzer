.PHONY: setup db-up db-down migrate ingest api web test lint typecheck fmt check

setup:            ## install python deps and web deps
	uv sync
	cd web && npm install

db-up:            ## start postgres
	docker compose up -d db

db-down:          ## stop postgres
	docker compose down

migrate:          ## apply migrations
	uv run baseball-analyzer migrate

ingest:           ## load the padres july 2024 file
	uv run baseball-analyzer ingest csv data/source_data.csv --dataset padres_july2024 --name "Padres July 2024"

api:              ## run the flask api on :8000
	uv run flask --app baseball_analyzer.api run --port 8000 --debug

web:              ## run the vite dev server
	cd web && npm run dev

test:             ## run all tests (db tests need postgres up + migrated)
	uv run pytest

lint:
	uv run ruff check src tests
	uv run ruff format --check src tests

typecheck:
	uv run mypy

fmt:
	uv run ruff format src tests
	uv run ruff check --fix src tests

check: lint typecheck test   ## everything CI would run
