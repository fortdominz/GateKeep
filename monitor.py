"""
GateKeep — Live monitoring CLI.
Opens a camera feed, detects faces, matches against banned list in real time.
Prints alerts to terminal and optionally saves snapshots on matches.

Usage:
  python monitor.py                      (camera 0, default threshold 0.45)
  python monitor.py --camera 1           (external camera)
  python monitor.py --threshold 0.50     (stricter matching)
  python monitor.py --no-display         (headless — terminal only, no window)
  python monitor.py --save-all           (save snapshot on every detection, not just matches)
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")

import argparse
import os
import sys
import time
import datetime

import cv2
import numpy as np

import db
import matcher

# How often (seconds) to re-run face detection — avoids 100% CPU on every frame
DETECTION_INTERVAL = 0.3

# Minimum detection score to bother matching
MIN_DET_SCORE = 0.5

# Cooldown: don't re-log same banned face within this many seconds
ALERT_COOLDOWN = 10.0


def draw_face_box(frame, bbox, label: str, color: tuple):
    x1, y1, x2, y2 = [int(v) for v in bbox]
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    cv2.putText(frame, label, (x1, y1 - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1, cv2.LINE_AA)


def save_snapshot(frame, label: str) -> str:
    snap_dir = os.path.join(os.path.dirname(__file__), "snapshots", "alerts")
    os.makedirs(snap_dir, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_label = label.replace(" ", "_")
    path = os.path.join(snap_dir, f"{ts}_{safe_label}.jpg")
    cv2.imwrite(path, frame)
    return path


def run(camera_id: int = 0, threshold: float = 0.45,
        display: bool = True, save_all: bool = False):

    db.init_db()

    cap = cv2.VideoCapture(camera_id)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open camera {camera_id}")
        sys.exit(1)

    print(f"[GateKeep] Monitoring started — camera={camera_id}  threshold={threshold}")
    print("[GateKeep] Press Q to quit.\n")

    # Cache banned embeddings — reload every 30s to pick up new enrollments
    banned_cache = db.get_banned_embeddings()
    last_cache_reload = time.time()

    # Per-identity cooldown tracker: {banned_id: last_alert_time}
    alert_times: dict[int, float] = {}

    last_detection_time = 0.0
    current_faces = []   # last detection result, drawn on every frame

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[WARN] Frame read failed.")
            time.sleep(0.05)
            continue

        now = time.time()

        # Reload banned list periodically
        if now - last_cache_reload > 30.0:
            banned_cache = db.get_banned_embeddings()
            last_cache_reload = now

        # Run detection on interval
        if now - last_detection_time >= DETECTION_INTERVAL:
            last_detection_time = now
            faces_raw = matcher.get_embeddings_from_frame(frame)
            current_faces = [f for f in faces_raw if f["det_score"] >= MIN_DET_SCORE]

            for face in current_faces:
                emb = face["embedding"]
                match = matcher.match_against_banned(emb, banned_cache, threshold=threshold)

                if match:
                    face_id = match["id"]
                    name = match["name"]
                    sim = match["similarity"]

                    # Check cooldown
                    last_alerted = alert_times.get(face_id, 0.0)
                    if now - last_alerted >= ALERT_COOLDOWN:
                        alert_times[face_id] = now
                        ts_str = datetime.datetime.now().strftime("%H:%M:%S")
                        print(f"[ALERT] {ts_str} — BANNED FACE DETECTED: {name}  "
                              f"(similarity={sim:.3f})")

                        snap_path = save_snapshot(frame, name)
                        db.log_detection(matched_id=face_id, matched_name=name,
                                         similarity=sim, snapshot_path=snap_path,
                                         camera_id=f"cam{camera_id}")
                        print(f"        Snapshot saved: {snap_path}")

                    face["_match"] = match
                else:
                    if save_all:
                        save_snapshot(frame, "unknown")
                    face["_match"] = None

        # Draw boxes on the current frame
        if display:
            display_frame = frame.copy()
            for face in current_faces:
                bbox = face["bbox"]
                match_info = face.get("_match")
                if match_info:
                    label = f"BANNED: {match_info['name']} ({match_info['similarity']:.2f})"
                    color = (0, 0, 220)    # red (BGR)
                else:
                    label = f"Unknown ({face['det_score']:.2f})"
                    color = (0, 200, 0)    # green

                draw_face_box(display_frame, bbox, label, color)

            cv2.putText(display_frame,
                        f"GateKeep | Banned: {len(banned_cache)} | Faces: {len(current_faces)}",
                        (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (220, 220, 220), 1, cv2.LINE_AA)
            cv2.imshow("GateKeep Monitor — Q to quit", display_frame)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        else:
            # Headless: just keep looping, terminal output handles alerts
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()
    print("[GateKeep] Monitoring stopped.")


def main():
    parser = argparse.ArgumentParser(description="GateKeep Live Monitor")
    parser.add_argument("--camera",    type=int,   default=0,    help="Camera index (default: 0)")
    parser.add_argument("--threshold", type=float, default=0.45, help="Match threshold 0–1 (default: 0.45)")
    parser.add_argument("--no-display",action="store_true",      help="Headless mode — no CV2 window")
    parser.add_argument("--save-all",  action="store_true",      help="Save snapshot on every detection")
    args = parser.parse_args()

    run(camera_id=args.camera,
        threshold=args.threshold,
        display=not args.no_display,
        save_all=args.save_all)


if __name__ == "__main__":
    main()
