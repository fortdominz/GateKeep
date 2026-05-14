"""
GateKeep — Log viewer CLI.
Print recent detection events from the database.

Usage:
  python logs.py              (last 50 events)
  python logs.py --limit 100  (last 100 events)
  python logs.py --alerts     (banned matches only)
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")

import argparse
import db


def main():
    db.init_db()

    parser = argparse.ArgumentParser(description="GateKeep Log Viewer")
    parser.add_argument("--limit",  type=int, default=50, help="Number of records to show")
    parser.add_argument("--alerts", action="store_true",  help="Show only matched (banned) detections")
    args = parser.parse_args()

    logs = db.get_recent_logs(limit=args.limit)

    if args.alerts:
        logs = [l for l in logs if l.get("matched_id") is not None]

    if not logs:
        print("No detection logs found.")
        return

    print(f"\n{'Time':<22} {'Camera':<8} {'Match':<25} {'Similarity':<12} {'Snapshot'}")
    print("-" * 100)
    for log in logs:
        name  = log.get("matched_name") or "—"
        sim   = f"{log['similarity']:.3f}" if log.get("matched_id") else "—"
        snap  = log.get("snapshot_path") or "—"
        cam   = log.get("camera_id", "cam0")
        ts    = log.get("timestamp", "")
        print(f"{ts:<22} {cam:<8} {name:<25} {sim:<12} {snap}")

    print(f"\nShowing {len(logs)} record(s).")


if __name__ == "__main__":
    main()
