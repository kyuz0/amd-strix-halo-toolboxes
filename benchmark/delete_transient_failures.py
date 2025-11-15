#!/usr/bin/env python3
import argparse
import glob
import os
import re

RESULTS_DIR_DEFAULT = "results"

# Same detection logic as your extractor
HEADER_RE = re.compile(r"^\|\s*model\s*\|", re.IGNORECASE)
SEP_RE    = re.compile(r"^\|\s*-+")

LOAD_ERR    = re.compile(r"failed to load model|Device memory allocation.*failed|⚠️\s*Fail", re.IGNORECASE)
HANG_ERR    = re.compile(r"GPU Hang|HW Exception", re.IGNORECASE)
GENERIC_ERR = re.compile(r"error:|exit \d+|runtime error|⚠️\s*Runtime Error", re.IGNORECASE)


def parse_table(text):
    lines = text.splitlines()
    rows = []
    header = None
    col_idx = {}

    for line in lines:
        if HEADER_RE.search(line):
            header = [c.strip().lower() for c in line.strip().strip("|").split("|")]
            for idx, name in enumerate(header):
                col_idx[name] = idx
            continue

        if header and (SEP_RE.search(line) or not line.strip()):
            continue

        if header and line.startswith("|"):
            parts = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(parts) < len(header):
                continue
            row = {}
            for name, idx in col_idx.items():
                row[name] = parts[idx]
            rows.append(row)

        if header and line.strip() == "" and rows:
            break

    return rows


def detect_error(text):
    if LOAD_ERR.search(text):
        return True
    if HANG_ERR.search(text):
        return True
    if GENERIC_ERR.search(text):
        return True
    return False


def is_non_transient_vram_issue(text):
    # Do NOT delete logs with this kind of Vulkan OOM
    return (
        "ggml_vulkan: Device memory allocation of size" in text
        and "Requested buffer size exceeds device buffer size limit" in text
    )


def is_failed_run(text):
    table_rows = parse_table(text)

    has_pp = any(r.get("test", "").lower() == "pp512" for r in table_rows)
    has_tg = any(r.get("test", "").lower() == "tg128" for r in table_rows)

    if has_pp or has_tg:
        return False

    return detect_error(text)


def main():
    ap = argparse.ArgumentParser(
        description="Delete transient-failure benchmark logs in results/"
    )
    ap.add_argument(
        "--results-dir",
        default=RESULTS_DIR_DEFAULT,
        help="Directory containing *.log files (default: results)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be deleted",
    )
    args = ap.parse_args()

    results_dir = args.results_dir
    pattern = os.path.join(results_dir, "*.log")

    to_delete = []
    skipped_non_transient = []

    for path in sorted(glob.glob(pattern)):
        try:
            with open(path, errors="ignore") as f:
                text = f.read()
        except OSError as e:
            print(f"Could not read {path}: {e}")
            continue

        if not is_failed_run(text):
            continue

        if is_non_transient_vram_issue(text):
            skipped_non_transient.append(path)
            continue

        to_delete.append(path)

    if not to_delete and not skipped_non_transient:
        print("No failed logs found.")
        return

    if skipped_non_transient:
        print("Keeping logs with non transient VRAM issues:")
        for p in skipped_non_transient:
            print(f"  KEEP  {p}")

    if to_delete:
        print("Deleting logs with transient failures:")
        for p in to_delete:
            print(f"  DELETE {p}")
            if not args.dry_run:
                try:
                    os.remove(p)
                except OSError as e:
                    print(f"    Failed to delete {p}: {e}")
    else:
        print("No logs to delete.")


if __name__ == "__main__":
    main()
