"""
GateKeep — Face matching engine.
Handles: embedding extraction (InsightFace) + cosine similarity against banned list.
"""

import numpy as np

# InsightFace lazy-loaded so the module can be imported even before install
_app = None


def _get_app():
    global _app
    if _app is None:
        import insightface
        from insightface.app import FaceAnalysis
        _app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        _app.prepare(ctx_id=0, det_size=(320, 320))
    return _app


def get_embeddings_from_frame(frame_bgr: np.ndarray) -> list:
    """
    Detect all faces in a frame and return their embeddings.
    Returns list of dicts: [{bbox, embedding, det_score}, ...]
    """
    fa = _get_app()
    faces = fa.get(frame_bgr)
    result = []
    for face in faces:
        result.append({
            "bbox": face.bbox.tolist(),          # [x1, y1, x2, y2]
            "embedding": face.normed_embedding.tolist(),   # 512-d normalized
            "det_score": float(face.det_score),
        })
    return result


def cosine_similarity(a: list, b: list) -> float:
    """Cosine similarity between two embedding lists (both already L2-normalized)."""
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    # Clamp to [-1, 1] to handle float rounding
    return float(np.clip(np.dot(va, vb), -1.0, 1.0))


def match_against_banned(embedding: list, banned_list: list, threshold: float = 0.45) -> dict | None:
    """
    Compare a face embedding against all banned embeddings.
    banned_list: [(id, name, embedding), ...]
    Returns best match dict if similarity >= threshold, else None.
    Dict: {id, name, similarity}
    """
    if not banned_list:
        return None

    best = None
    best_sim = -1.0

    for face_id, name, banned_emb in banned_list:
        sim = cosine_similarity(embedding, banned_emb)
        if sim > best_sim:
            best_sim = sim
            best = {"id": face_id, "name": name, "similarity": sim}

    if best and best_sim >= threshold:
        return best
    return None
