"""
GateKeep — Enrollment CLI.
Add a person to the banned list from an image file or live webcam capture.

Usage:
  python enroll.py --name "John Doe" --image path/to/photo.jpg
  python enroll.py --name "John Doe" --camera          (capture from webcam)
  python enroll.py --list                               (show all banned faces)
  python enroll.py --remove <id>                        (remove a face by ID)
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")

import argparse
import sys
import os
import cv2

import db
import matcher


def enroll_from_image(name: str, image_path: str, notes: str = ""):
    if not os.path.exists(image_path):
        print(f"[ERROR] Image not found: {image_path}")
        sys.exit(1)

    frame = cv2.imread(image_path)
    if frame is None:
        print(f"[ERROR] Could not read image: {image_path}")
        sys.exit(1)

    faces = matcher.get_embeddings_from_frame(frame)

    if len(faces) == 0:
        print("[ERROR] No face detected in the image. Try a clearer photo.")
        sys.exit(1)

    if len(faces) > 1:
        print(f"[WARN] {len(faces)} faces detected. Using the highest-confidence one.")

    best_face = max(faces, key=lambda f: f["det_score"])
    embedding = best_face["embedding"]

    face_id = db.add_banned_face(name=name, embedding=embedding, notes=notes, image_path=image_path)
    print(f"[OK] Enrolled '{name}' as banned face ID {face_id}  (det_score={best_face['det_score']:.3f})")


def enroll_from_camera(name: str, notes: str = ""):
    print(f"Enrolling '{name}' from webcam. Press SPACE to capture, Q to cancel.")
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Cannot open webcam.")
        sys.exit(1)

    enrolled = False
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        cv2.imshow("GateKeep Enroll — SPACE to capture, Q to quit", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord(" "):
            faces = matcher.get_embeddings_from_frame(frame)
            if not faces:
                print("[WARN] No face detected. Try again.")
                continue

            best_face = max(faces, key=lambda f: f["det_score"])
            embedding = best_face["embedding"]

            # Save snapshot
            snap_dir = os.path.join(os.path.dirname(__file__), "snapshots", "enroll")
            os.makedirs(snap_dir, exist_ok=True)
            snap_path = os.path.join(snap_dir, f"{name.replace(' ', '_')}_enroll.jpg")
            cv2.imwrite(snap_path, frame)

            face_id = db.add_banned_face(name=name, embedding=embedding, notes=notes, image_path=snap_path)
            print(f"[OK] Enrolled '{name}' as banned face ID {face_id}  (det_score={best_face['det_score']:.3f})")
            print(f"     Snapshot saved to: {snap_path}")
            enrolled = True
            break

        elif key == ord("q"):
            print("[CANCELLED]")
            break

    cap.release()
    cv2.destroyAllWindows()
    if not enrolled:
        sys.exit(1)


def list_banned():
    faces = db.get_all_banned_faces()
    if not faces:
        print("Banned list is empty.")
        return

    print(f"\n{'ID':<6} {'Name':<25} {'Notes':<30} {'Added'}")
    print("-" * 80)
    for f in faces:
        print(f"{f['id']:<6} {f['name']:<25} {(f['notes'] or ''):<30} {f['added_at']}")
    print(f"\nTotal: {len(faces)}")


def remove_face(face_id: int):
    face = db.get_banned_face_by_id(face_id)
    if not face:
        print(f"[ERROR] No banned face with ID {face_id}")
        sys.exit(1)
    db.delete_banned_face(face_id)
    print(f"[OK] Removed '{face['name']}' (ID {face_id}) from banned list.")


def main():
    db.init_db()

    parser = argparse.ArgumentParser(description="GateKeep Enrollment Tool")
    parser.add_argument("--name",   type=str, help="Name to enroll")
    parser.add_argument("--image",  type=str, help="Path to image file")
    parser.add_argument("--camera", action="store_true", help="Enroll from webcam")
    parser.add_argument("--notes",  type=str, default="", help="Optional notes")
    parser.add_argument("--list",   action="store_true", help="List all banned faces")
    parser.add_argument("--remove", type=int, help="Remove a face by ID")

    args = parser.parse_args()

    if args.list:
        list_banned()
    elif args.remove is not None:
        remove_face(args.remove)
    elif args.name and args.image:
        enroll_from_image(args.name, args.image, notes=args.notes)
    elif args.name and args.camera:
        enroll_from_camera(args.name, notes=args.notes)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
