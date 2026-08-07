#!/usr/bin/env python3
"""Merge new cockpit curve-summary rows without replacing existing results."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


KEY_FIELDS = ("model", "toolbox", "series", "starting_depth")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("additions", type=Path, nargs="+")
    return parser.parse_args()


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        if not fields:
            raise ValueError(f"Missing CSV header: {path}")
        missing = set(KEY_FIELDS) - set(fields)
        if missing:
            raise ValueError(f"{path} is missing key fields: {', '.join(sorted(missing))}")
        return fields, list(reader)


def row_key(row: dict[str, str]) -> tuple[str, ...]:
    return tuple(row[field] for field in KEY_FIELDS)


def main() -> None:
    args = parse_args()
    fields, destination_rows = read_rows(args.destination)
    merged = {row_key(row): row for row in destination_rows}
    added = 0

    for addition in args.additions:
        addition_fields, rows = read_rows(addition)
        if addition_fields != fields:
            raise ValueError(f"CSV columns differ: {addition}")
        for row in rows:
            key = row_key(row)
            existing = merged.get(key)
            if existing is not None and existing != row:
                raise ValueError(f"Conflicting row for {key} in {addition}")
            if existing is None:
                merged[key] = row
                added += 1

    rows = sorted(
        merged.values(),
        key=lambda row: (
            row["toolbox"],
            row["model"],
            row["series"],
            int(row["starting_depth"]),
        ),
    )
    temporary = args.destination.with_suffix(args.destination.suffix + ".tmp")
    with temporary.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(args.destination)
    print(f"Merged {added} new rows into {args.destination} ({len(rows)} total)")


if __name__ == "__main__":
    main()
