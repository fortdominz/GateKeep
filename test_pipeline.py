"""
GateKeep — Pipeline smoke test (no camera required).
Tests:
  1. DB init + insert + query
  2. Embedding extraction from a test image (if provided)
  3. Cosine similarity math

Usage:
  python test_pipeline.py                        (DB + similarity only)
  python test_pipeline.py --image path/to/img    (full pipeline with image)
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")

import argparse
import sys
import numpy as np

import db
import matcher


def test_db():
    print("-- Test 1: Database ---------------------------------")
    db.init_db()
    print("   init_db() OK")

    dummy_emb = list(np.random.randn(512).astype(np.float32))
    # Normalize (InsightFace returns normed embeddings)
    norm = np.linalg.norm(dummy_emb)
    dummy_emb = [v / norm for v in dummy_emb]

    face_id = db.add_banned_face("Test Person", dummy_emb, notes="smoke test")
    print(f"   add_banned_face() -> ID {face_id}")

    faces = db.get_all_banned_faces()
    assert any(f["id"] == face_id for f in faces), "Face not found after insert"
    print(f"   get_all_banned_faces() -> {len(faces)} face(s)")

    banned = db.get_banned_embeddings()
    assert any(bid == face_id for bid, _, _ in banned)
    print(f"   get_banned_embeddings() -> {len(banned)} entry/entries")

    db.delete_banned_face(face_id)
    assert db.get_banned_face_by_id(face_id) is None
    print(f"   delete_banned_face() -> confirmed gone")
    print("   PASS\n")


def test_similarity():
    print("-- Test 2: Cosine similarity ------------------------")
    a = [1.0, 0.0, 0.0]
    b = [1.0, 0.0, 0.0]
    assert abs(matcher.cosine_similarity(a, b) - 1.0) < 1e-5, "Same vector should be 1.0"

    c = [0.0, 1.0, 0.0]
    assert abs(matcher.cosine_similarity(a, c) - 0.0) < 1e-5, "Orthogonal vectors should be 0.0"

    d = [-1.0, 0.0, 0.0]
    assert abs(matcher.cosine_similarity(a, d) - (-1.0)) < 1e-5, "Opposite vector should be -1.0"

    print("   Same vector:       1.000  OK")
    print("   Orthogonal:        0.000  OK")
    print("   Opposite:         -1.000  OK")
    print("   PASS\n")


def test_matcher_logic():
    print("-- Test 3: match_against_banned() logic -------------")
    rng = np.random.default_rng(42)

    def rand_emb():
        v = rng.standard_normal(512).astype(np.float32)
        return (v / np.linalg.norm(v)).tolist()

    emb_banned = rand_emb()
    emb_similar = [e + rng.standard_normal() * 0.02 for e in emb_banned]
    norm = np.linalg.norm(emb_similar)
    emb_similar = [e / norm for e in emb_similar]
    emb_stranger = rand_emb()

    banned_list = [(1, "Banned Person", emb_banned)]

    match = matcher.match_against_banned(emb_similar, banned_list, threshold=0.45)
    assert match is not None, "Similar embedding should match"
    print(f"   Similar face matched: '{match['name']}' (sim={match['similarity']:.3f})  OK")

    no_match = matcher.match_against_banned(emb_stranger, banned_list, threshold=0.45)
    assert no_match is None, "Stranger should not match"
    print(f"   Stranger face:       no match  OK")
    print("   PASS\n")


def test_with_image(image_path: str):
    print(f"-- Test 4: Full pipeline with image -----------------")
    import cv2
    frame = cv2.imread(image_path)
    if frame is None:
        print(f"   [ERROR] Cannot read image: {image_path}")
        return

    print(f"   Reading image: {image_path}")
    faces = matcher.get_embeddings_from_frame(frame)
    print(f"   Detected {len(faces)} face(s)")

    for i, face in enumerate(faces):
        print(f"   Face {i+1}: det_score={face['det_score']:.3f}  "
              f"embedding_len={len(face['embedding'])}")
    print("   PASS\n")


def main():
    parser = argparse.ArgumentParser(description="GateKeep pipeline smoke test")
    parser.add_argument("--image", type=str, default=None, help="Optional image path for full test")
    args = parser.parse_args()

    print("GateKeep Smoke Test\n")

    test_db()
    test_similarity()
    test_matcher_logic()

    if args.image:
        test_with_image(args.image)
    else:
        print("(Skipping image test — pass --image path/to/image.jpg to include it)")

    print("All tests passed.")


if __name__ == "__main__":
    main()
