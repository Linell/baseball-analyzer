"""Command line: migrate the schema, ingest a CSV, compute baselines."""

import argparse
import sys
from pathlib import Path

from baseball_analyzer import db
from baseball_analyzer.baselines import compute_baselines
from baseball_analyzer.ingest import IngestError, ingest_csv


def main() -> None:
    parser = argparse.ArgumentParser(prog="baseball-analyzer")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("migrate", help="apply migrations")

    ingest = commands.add_parser("ingest", help="load a CSV as one dataset")
    ingest_kinds = ingest.add_subparsers(dest="kind", required=True)
    csv_cmd = ingest_kinds.add_parser("csv")
    csv_cmd.add_argument("path", type=Path)
    csv_cmd.add_argument("--dataset", required=True, help="dataset key, e.g. padres_july2024")
    csv_cmd.add_argument("--name", help="display name; defaults to the key")
    csv_cmd.add_argument("--reference", action="store_true", help="keep out of the hitter picker")
    csv_cmd.add_argument("--replace", action="store_true", help="reload an existing key")

    baselines_cmd = commands.add_parser("baselines", help="replace league baselines")
    baselines_cmd.add_argument("--from", dest="from_key", required=True, metavar="DATASET_KEY")

    args = parser.parse_args()
    with db.connect() as conn:
        if args.command == "migrate":
            applied = db.migrate(conn)
            print(f"applied: {', '.join(applied) if applied else 'nothing new'}")
        elif args.command == "baselines":
            try:
                figures = compute_baselines(conn, args.from_key)
            except ValueError as exc:
                sys.exit(f"error: {exc}")
            print(f"baselines replaced from {args.from_key}: {figures} hitter-metric figures")
        else:
            try:
                counts = ingest_csv(
                    conn, args.path, args.dataset, args.name, args.reference, args.replace
                )
            except IngestError as exc:
                sys.exit(f"error: {exc}")
            print(f"{args.dataset}: {counts['rows']} rows, {counts['pitches']} pitches")
