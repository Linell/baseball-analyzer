#!/bin/sh
# Migrate, seed only if the dataset is absent or short, then serve. No separate
# seed service: a service_completed_successfully edge evaporates on reboot.
set -eu

baseball-analyzer migrate
baseball-analyzer ingest csv data/source_data.csv \
    --dataset padres_july2024 --name "Padres July 2024" --if-missing

# Preload is safe: nothing opens a database connection at module level.
exec gunicorn \
    --bind 0.0.0.0:8000 \
    --workers 2 --threads 4 --worker-class gthread \
    --timeout 30 --graceful-timeout 10 \
    --max-requests 500 --max-requests-jitter 50 \
    --preload \
    baseball_analyzer.api:app
