#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scan a documents directory and emit a two-column TSV with "
            "project-root-relative paths and placeholder descriptions."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help="Project root used to compute relative paths. Defaults to the current directory.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("assets/documents"),
        help="Directory containing source documents. Defaults to assets/documents.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/documents_index.tsv"),
        help="TSV file to write. Defaults to assets/documents_index.tsv.",
    )
    parser.add_argument(
        "--default-description",
        default="NA",
        help="Placeholder description to write for each document. Defaults to NA.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = args.root.resolve()
    source_dir = (project_root / args.source).resolve()
    output_path = (project_root / args.output).resolve()

    if not source_dir.exists():
        raise SystemExit(f"Source directory does not exist: {source_dir}")
    if not source_dir.is_dir():
        raise SystemExit(f"Source path is not a directory: {source_dir}")

    files = sorted(path for path in source_dir.rglob("*") if path.is_file())

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["relative_path", "description"])
        for path in files:
            writer.writerow(
                [path.relative_to(project_root).as_posix(), args.default_description]
            )

    print(f"Wrote {len(files)} rows to {output_path.relative_to(project_root).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
