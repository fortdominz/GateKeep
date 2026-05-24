"""
GateKeep — FastAPI Backend (multi-user browser-camera version)

Each visitor runs their own camera in the browser via getUserMedia().
Frames are POSTed to /api/detect; InsightFace runs here on Render.
All data is scoped to a per-visitor session_id (UUID stored in localStorage).
"""

import sys
import os
import io
import time
import threading
import datetime
import zipfile
import hashlib
import secrets

import cv2
import numpy as np

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List

# db and matcher live one level up
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import db
import matcher

app = FastAPI(title="GateKeep — Intruders Camera System", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
        "http://localhost:4173",
        "https://gatekeep.dominioneze.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db.init_db()

# Serve snapshots as static files at /snapshots/alerts/<filename>
# Honour GATEKEEP_DATA_DIR so snapshots survive deploys on Render (persistent disk)
_data_dir     = os.environ.get("GATEKEEP_DATA_DIR") or os.path.dirname(os.path.dirname(__file__))
SNAPSHOTS_DIR = os.path.abspath(os.path.join(_data_dir, "snapshots"))
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
app.mount("/snapshots", StaticFiles(directory=SNAPSHOTS_DIR), name="snapshots")


# ── ADMIN AUTH ────────────────────────────────────────────────────────────────

# In-memory session store: token → expiry timestamp (epoch seconds)
_sessions: dict[str, float] = {}


def _hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode("utf-8")).hexdigest()


async def require_admin(x_admin_token: Optional[str] = Header(None)):
    """FastAPI dependency — validates the X-Admin-Token header."""
    if not x_admin_token or _sessions.get(x_admin_token, 0) < time.time():
        raise HTTPException(status_code=401, detail="Admin token required or session expired")
    return x_admin_token


class AdminLoginBody(BaseModel):
    password: str


class ChangePasswordBody(BaseModel):
    new_password: str


class ThresholdBody(BaseModel):
    threshold: float


@app.post("/api/admin/login")
def admin_login(body: AdminLoginBody):
    stored = db.get_admin_password_hash()
    if not stored or _hash_pw(body.password) != stored:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = secrets.token_hex(32)
    _sessions[token] = time.time() + 8 * 3600   # 8-hour session
    return {"token": token}


@app.post("/api/admin/logout")
async def admin_logout(token: str = Depends(require_admin)):
    _sessions.pop(token, None)
    return {"ok": True}


@app.post("/api/admin/change-password")
async def change_password(body: ChangePasswordBody, token: str = Depends(require_admin)):
    if len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    db.set_admin_password_hash(_hash_pw(body.new_password))
    return {"ok": True}


@app.delete("/api/admin/logs")
async def admin_clear_logs(
    session_id: str = Query("default"),
    log_type: str = None,
    token: str = Depends(require_admin),
):
    """Wipe all logs or only logs of a specific type for a session."""
    db.clear_detection_log(session_id=session_id, log_type=log_type or None)
    label = f"{log_type} log" if log_type else "full detection log"
    return {"ok": True, "message": f"{label} cleared"}


@app.delete("/api/admin/snapshots")
async def admin_wipe_snapshots(token: str = Depends(require_admin)):
    """Delete all alert snapshot images from disk."""
    alerts_dir = os.path.join(SNAPSHOTS_DIR, "alerts")
    count = 0
    if os.path.isdir(alerts_dir):
        for fname in os.listdir(alerts_dir):
            fp = os.path.join(alerts_dir, fname)
            if os.path.isfile(fp):
                os.remove(fp)
                count += 1
    return {"ok": True, "deleted": count}


@app.post("/api/admin/threshold")
async def admin_set_threshold(
    body: ThresholdBody,
    session_id: str = Query("default"),
    token: str = Depends(require_admin),
):
    if not (0.1 <= body.threshold <= 1.0):
        raise HTTPException(status_code=400, detail="Threshold must be 0.1 – 1.0")
    db.set_session_threshold(session_id, body.threshold)
    return {"ok": True, "threshold": body.threshold}


# ── MODEL ─────────────────────────────────────────────────────────────────────

_model_ready = False


def _warm_model():
    global _model_ready
    try:
        matcher._get_app()
        _model_ready = True
        print("[GateKeep] Detection model ready.")
    except Exception as e:
        print(f"[GateKeep] Model load failed: {e}")


@app.on_event("startup")
def on_startup():
    print(f"[GateKeep] Database  : {db.DB_PATH}")
    print(f"[GateKeep] Snapshots : {SNAPSHOTS_DIR}")
    threading.Thread(target=_warm_model, daemon=True).start()


# ── PER-SESSION IN-MEMORY STATE ───────────────────────────────────────────────

ALERT_COOLDOWN = 10.0  # seconds between re-logging the same face

# session_id → {face_id (int) → last_alert_time (float)}
_session_alert_times:  dict[str, dict] = {}
# session_id → {face_id (int) → last_known_time (float)}
_session_known_times:  dict[str, dict] = {}
# session_id → {bbox_key (tuple) → last_unauth_time (float)}
_session_unauth_times: dict[str, dict] = {}

# Embedding cache: session_id → (banned_list, allowed_list, last_reload_epoch)
_session_cache: dict[str, tuple] = {}
_cache_lock = threading.Lock()


def _get_session_caches(session_id: str):
    """Return (banned_embeddings, allowed_embeddings), refreshing every 30s."""
    now = time.time()
    with _cache_lock:
        entry = _session_cache.get(session_id)
        if entry is None or now - entry[2] > 30.0:
            banned  = db.get_banned_embeddings(session_id)
            allowed = db.get_allowed_embeddings(session_id)
            _session_cache[session_id] = (banned, allowed, now)
            return banned, allowed
        return entry[0], entry[1]


def _invalidate_session_cache(session_id: str):
    """Force-refresh on next detect call (after enroll / delete)."""
    with _cache_lock:
        _session_cache.pop(session_id, None)


def _session_threat(session_id: str) -> str:
    """Derive current threat level from per-session cooldown timestamps."""
    mode = db.get_session_mode(session_id)
    now  = time.time()

    alert_times  = _session_alert_times.get(session_id, {})
    unauth_times = _session_unauth_times.get(session_id, {})

    banned_secs = (now - max(alert_times.values()))  if alert_times  else None
    unauth_secs = (now - max(unauth_times.values())) if unauth_times else None

    if mode == "BANNED_ONLY":
        if banned_secs is None:    return "NOMINAL"
        if banned_secs <= 10:      return "CRITICAL"
        if banned_secs <= 60:      return "HIGH"
        if banned_secs <= 600:     return "ELEVATED"
        return "NOMINAL"

    if mode == "ALLOWLIST_ONLY":
        if unauth_secs is None:    return "NOMINAL"
        if unauth_secs <= 10:      return "HIGH"
        if unauth_secs <= 120:     return "ELEVATED"
        return "NOMINAL"

    # COMBINED — banned takes priority
    if banned_secs is not None:
        if banned_secs <= 10:      return "CRITICAL"
        if banned_secs <= 60:      return "HIGH"
    if unauth_secs is not None:
        if unauth_secs <= 10:      return "HIGH"
        if unauth_secs <= 120:     return "ELEVATED"
    if banned_secs is not None and banned_secs <= 600:
        return "ELEVATED"
    return "NOMINAL"


def _bbox_key(x1, y1, x2, y2):
    """Quantise bbox to 50-px grid — cooldown key for unidentified faces."""
    return (x1 // 50, y1 // 50, x2 // 50, y2 // 50)


def _save_snapshot(frame: np.ndarray, label: str) -> str:
    snap_dir = os.path.join(SNAPSHOTS_DIR, "alerts")
    os.makedirs(snap_dir, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_label = label.strip().replace(" ", "_")
    path = os.path.join(snap_dir, f"{ts}_{safe_label}.jpg")
    cv2.imwrite(path, frame)
    return path


# ── DETECT ENDPOINT ───────────────────────────────────────────────────────────

@app.post("/api/detect")
async def detect(
    session_id: str  = Form("default"),
    image: UploadFile = File(...),
):
    """
    Accept a JPEG frame from the browser camera (multipart/form-data).
    Run InsightFace, match against session's lists, log with cooldown,
    and return bounding boxes + threat level.
    """
    if not _model_ready:
        return {"faces": [], "threat": "NOMINAL", "model_ready": False}

    contents = await image.read()
    np_arr   = np.frombuffer(contents, np.uint8)
    frame    = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    h, w      = frame.shape[:2]
    mode      = db.get_session_mode(session_id)
    threshold = db.get_session_threshold(session_id)
    banned_cache, allowed_cache = _get_session_caches(session_id)

    now          = time.time()
    alert_times  = _session_alert_times.setdefault(session_id, {})
    known_times  = _session_known_times.setdefault(session_id, {})
    unauth_times = _session_unauth_times.setdefault(session_id, {})

    try:
        raw_faces = matcher.get_embeddings_from_frame(frame)
    except Exception as exc:
        print(f"[GateKeep] Detection error: {exc}")
        return {"faces": [], "threat": _session_threat(session_id), "model_ready": True}

    result_faces = []
    for face in raw_faces:
        if face["det_score"] < 0.5:
            continue

        x1, y1, x2, y2 = [int(v) for v in face["bbox"]]
        emb = face["embedding"]

        banned_match  = None
        allowed_match = None

        if mode in ("BANNED_ONLY", "COMBINED"):
            banned_match = matcher.match_against_banned(emb, banned_cache, threshold)

        if mode in ("ALLOWLIST_ONLY", "COMBINED"):
            allowed_match = matcher.match_against_banned(emb, allowed_cache, threshold)

        log_type     = "UNKNOWN"
        label        = f"Unknown ({face['det_score']:.2f})"
        matched_name = ""
        similarity   = 0.0

        if banned_match and mode in ("BANNED_ONLY", "COMBINED"):
            log_type     = "BANNED_ALERT"
            matched_name = banned_match["name"]
            similarity   = banned_match["similarity"]
            label        = f"BANNED: {matched_name} ({similarity:.2f})"
            face_id      = banned_match["id"]

            if now - alert_times.get(face_id, 0.0) >= ALERT_COOLDOWN:
                alert_times[face_id] = now
                snap_path = _save_snapshot(frame, f"BANNED_{matched_name}")
                db.log_detection(
                    session_id=session_id,
                    matched_id=face_id,
                    matched_name=matched_name,
                    similarity=similarity,
                    snapshot_path=snap_path,
                    camera_id="browser",
                    log_type="BANNED_ALERT",
                    detection_mode=mode,
                )
                print(f"[GateKeep] [{session_id[:8]}] BANNED_ALERT — {matched_name} ({similarity:.3f})")

        elif allowed_match and mode in ("ALLOWLIST_ONLY", "COMBINED"):
            log_type     = "KNOWN_ENTRY"
            matched_name = allowed_match["name"]
            similarity   = allowed_match["similarity"]
            label        = f"ALLOWED: {matched_name} ({similarity:.2f})"
            face_id      = allowed_match["id"]

            if now - known_times.get(face_id, 0.0) >= ALERT_COOLDOWN:
                known_times[face_id] = now
                db.log_detection(
                    session_id=session_id,
                    matched_id=face_id,
                    matched_name=matched_name,
                    similarity=similarity,
                    snapshot_path="",
                    camera_id="browser",
                    log_type="KNOWN_ENTRY",
                    detection_mode=mode,
                )
                print(f"[GateKeep] [{session_id[:8]}] KNOWN_ENTRY — {matched_name}")

        elif mode in ("ALLOWLIST_ONLY", "COMBINED"):
            log_type = "UNAUTHORIZED"
            label    = f"UNAUTHORIZED ({face['det_score']:.2f})"
            bbox_key = _bbox_key(x1, y1, x2, y2)

            if now - unauth_times.get(bbox_key, 0.0) >= ALERT_COOLDOWN:
                unauth_times[bbox_key] = now
                snap_path = _save_snapshot(frame, "UNAUTHORIZED")
                db.log_detection(
                    session_id=session_id,
                    matched_id=None,
                    matched_name="",
                    similarity=0.0,
                    snapshot_path=snap_path,
                    camera_id="browser",
                    log_type="UNAUTHORIZED",
                    detection_mode=mode,
                )
                print(f"[GateKeep] [{session_id[:8]}] UNAUTHORIZED face detected")

        result_faces.append({
            # Normalised bbox so the frontend can overlay on any video size
            "bbox_pct": {
                "x": x1 / w,
                "y": y1 / h,
                "w": (x2 - x1) / w,
                "h": (y2 - y1) / h,
            },
            "label":        label,
            "log_type":     log_type,
            "matched_name": matched_name,
            "similarity":   round(similarity, 3),
            "det_score":    round(face["det_score"], 3),
        })

    return {
        "faces":       result_faces,
        "threat":      _session_threat(session_id),
        "model_ready": True,
        "mode":        mode,
    }


# ── HEALTH ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "status":      "ok",
        "model_ready": _model_ready,
        "time":        datetime.datetime.now().isoformat(timespec="seconds"),
    }


# ── BANNED LIST ───────────────────────────────────────────────────────────────

@app.get("/api/banned")
def get_banned(session_id: str = Query("default")):
    faces = db.get_all_banned_faces(session_id)
    return [{k: v for k, v in f.items() if k != "embedding"} for f in faces]


@app.delete("/api/banned/{face_id}")
def delete_banned(face_id: int, session_id: str = Query("default")):
    face = db.get_banned_face_by_id(face_id, session_id)
    if not face:
        raise HTTPException(status_code=404, detail="Face not found")
    db.delete_banned_face(face_id)
    _invalidate_session_cache(session_id)
    return {"deleted": True, "name": face["name"]}


# ── ALLOWED LIST ──────────────────────────────────────────────────────────────

@app.get("/api/allowed")
def get_allowed(session_id: str = Query("default")):
    faces = db.get_all_allowed_faces(session_id)
    return [{k: v for k, v in f.items() if k != "embedding"} for f in faces]


@app.delete("/api/allowed/{face_id}")
def delete_allowed(face_id: int, session_id: str = Query("default")):
    face = db.get_allowed_face_by_id(face_id, session_id)
    if not face:
        raise HTTPException(status_code=404, detail="Face not found")
    db.delete_allowed_face(face_id)
    _invalidate_session_cache(session_id)
    return {"deleted": True, "name": face["name"]}


# ── DETECTION MODE ────────────────────────────────────────────────────────────

class SetModeBody(BaseModel):
    mode: str


@app.get("/api/mode")
def get_mode(session_id: str = Query("default")):
    return {"mode": db.get_session_mode(session_id)}


@app.post("/api/mode")
def set_mode(body: SetModeBody, session_id: str = Query("default")):
    valid = {"BANNED_ONLY", "ALLOWLIST_ONLY", "COMBINED"}
    if body.mode not in valid:
        raise HTTPException(status_code=400, detail=f"Mode must be one of {valid}")
    db.set_session_mode(session_id, body.mode)
    # Reset cooldown timers so the new mode starts clean
    _session_alert_times.pop(session_id, None)
    _session_known_times.pop(session_id, None)
    _session_unauth_times.pop(session_id, None)
    return {"mode": body.mode}


# ── ENROLL ────────────────────────────────────────────────────────────────────

@app.post("/api/enroll", status_code=201)
async def enroll_face(
    session_id: str  = Form("default"),
    name:       str  = Form(...),
    notes:      str  = Form(default=""),
    list_type:  str  = Form(default="banned"),   # "banned" | "allowed"
    image: UploadFile = File(...),
):
    if not name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")

    contents = await image.read()
    np_arr   = np.frombuffer(contents, np.uint8)
    frame    = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    faces = matcher.get_embeddings_from_frame(frame)
    if not faces:
        raise HTTPException(
            status_code=422,
            detail="No face detected in the image. Try a clearer photo."
        )

    best_face = max(faces, key=lambda f: f["det_score"])
    embedding = best_face["embedding"]

    target = list_type.lower() if list_type.lower() in ("banned", "allowed") else "banned"
    snap_dir = os.path.abspath(
        os.path.join(_data_dir, "snapshots", "enroll", target)
    )
    os.makedirs(snap_dir, exist_ok=True)
    safe_name = name.strip().replace(" ", "_")
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    save_path = os.path.join(snap_dir, f"{ts}_{safe_name}.jpg")
    cv2.imwrite(save_path, frame)

    if target == "allowed":
        face_id = db.add_allowed_face(
            session_id=session_id,
            name=name.strip(),
            embedding=embedding,
            notes=notes.strip(),
            image_path=save_path,
        )
    else:
        face_id = db.add_banned_face(
            session_id=session_id,
            name=name.strip(),
            embedding=embedding,
            notes=notes.strip(),
            image_path=save_path,
        )

    _invalidate_session_cache(session_id)
    return {
        "id":         face_id,
        "name":       name.strip(),
        "list_type":  target,
        "det_score":  round(best_face["det_score"], 3),
        "image_path": save_path,
    }


# ── DETECTION LOG ─────────────────────────────────────────────────────────────

def _add_snapshot_url(log: dict) -> dict:
    """Attach a web-accessible snapshot_url to a log entry if a snapshot exists."""
    path = log.get("snapshot_path", "")
    if path and os.path.isfile(path):
        filename = os.path.basename(path)
        log["snapshot_url"] = f"/snapshots/alerts/{filename}"
    else:
        log["snapshot_url"] = None
    return log


LOG_TYPE_ALERTS = {"BANNED_ALERT", "UNAUTHORIZED"}


@app.get("/api/logs")
def get_logs(
    session_id:  str  = Query("default"),
    limit:       int  = 50,
    alerts_only: bool = False,
    log_type:    str  = None,
):
    """
    log_type: BANNED_ALERT | UNAUTHORIZED | KNOWN_ENTRY | UNKNOWN | alerts | all
    alerts_only: shorthand for log_type=alerts
    """
    if log_type == "alerts" or alerts_only:
        logs = db.get_recent_logs(session_id, limit=limit, log_types=list(LOG_TYPE_ALERTS))
    elif log_type and log_type != "all":
        logs = db.get_recent_logs(session_id, limit=limit, log_types=[log_type])
    else:
        logs = db.get_recent_logs(session_id, limit=limit)
    return [_add_snapshot_url(l) for l in logs]


# ── SNAPSHOT EXPORT ───────────────────────────────────────────────────────────

class ExportBody(BaseModel):
    paths: List[str]


@app.post("/api/snapshots/export")
async def export_snapshots(body: ExportBody, token: str = Depends(require_admin)):
    """Package requested snapshots into a ZIP and stream it back."""
    buf   = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in body.paths:
            clean = rel.lstrip("/")
            if clean.startswith("snapshots/"):
                clean = clean[len("snapshots/"):]
            full = os.path.join(SNAPSHOTS_DIR, clean)
            if os.path.isfile(full):
                zf.write(full, os.path.basename(full))
                added += 1
    if added == 0:
        raise HTTPException(status_code=404, detail="No valid snapshots found for export.")
    buf.seek(0)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="gatekeep_evidence_{ts}.zip"'},
    )


# ── DASHBOARD STATS ───────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats(session_id: str = Query("default")):
    banned  = db.get_all_banned_faces(session_id)
    allowed = db.get_all_allowed_faces(session_id)
    logs    = db.get_recent_logs(session_id, limit=500)

    cutoff = (
        datetime.datetime.now() - datetime.timedelta(hours=24)
    ).isoformat(timespec="seconds")
    recent = [l for l in logs if l.get("timestamp", "") >= cutoff]

    def count_type(records, lt):
        return sum(1 for l in records if l.get("log_type") == lt)

    return {
        "banned_count":            len(banned),
        "allowed_count":           len(allowed),
        "detection_mode":          db.get_session_mode(session_id),
        "total_detections":        len(logs),
        "total_alerts":            count_type(logs,   "BANNED_ALERT"),
        "alerts_last_24h":         count_type(recent, "BANNED_ALERT"),
        "unauthorized_last_24h":   count_type(recent, "UNAUTHORIZED"),
        "known_entries_last_24h":  count_type(recent, "KNOWN_ENTRY"),
        "current_threat":          _session_threat(session_id),
    }
