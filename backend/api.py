"""
GateKeep — FastAPI Backend
Wraps db.py + matcher.py for the React frontend.
All camera-facing work still runs in monitor.py (separate process).
The API handles: banned list CRUD, enroll from upload, detection log, MJPEG stream.
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

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List

# db and matcher live one level up
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import db
import matcher

app = FastAPI(title="GateKeep — Intruders Camera System", version="1.0.0")

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
async def admin_clear_logs(log_type: str = None, token: str = Depends(require_admin)):
    """Wipe all logs or only logs of a specific type."""
    db.clear_detection_log(log_type=log_type or None)
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
async def admin_set_threshold(body: ThresholdBody, token: str = Depends(require_admin)):
    if not (0.1 <= body.threshold <= 1.0):
        raise HTTPException(status_code=400, detail="Threshold must be 0.1 – 1.0")
    cam_state.threshold = body.threshold
    return {"ok": True, "threshold": cam_state.threshold}


# Serve snapshots as static files at /snapshots/alerts/<filename>
SNAPSHOTS_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)), "snapshots"))
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
app.mount("/snapshots", StaticFiles(directory=SNAPSHOTS_DIR), name="snapshots")


# ── CAMERA STREAM ─────────────────────────────────────────────────────────────

ALERT_COOLDOWN = 10.0   # seconds between re-logging the same banned face


class CameraState:
    def __init__(self):
        self.cap          = None
        self.cap_lock     = threading.Lock()
        self.active       = False
        self.threshold    = 0.45
        self.model_ready  = False
        self.camera_id    = 0

        # Detection mode: 'BANNED_ONLY' | 'ALLOWLIST_ONLY' | 'COMBINED'
        self.mode         = db.get_detection_mode() if hasattr(db, 'get_detection_mode') else 'BANNED_ONLY'

        # Cooldown trackers
        self.alert_times:         dict[int, float]   = {}   # banned face_id → last alert time
        self.known_entry_times:   dict[int, float]   = {}   # allowed face_id → last log time
        self.unauthorized_times:  dict[tuple, float] = {}   # bbox_key → last alert time

        # Latest raw frame
        self.latest_frame: np.ndarray | None = None
        self.frame_lock   = threading.Lock()

        # Latest detection results
        self.last_faces: list = []
        self.faces_lock   = threading.Lock()

cam_state = CameraState()


def _warm_model():
    """Pre-load InsightFace on startup so first detection is instant."""
    try:
        matcher._get_app()
        cam_state.model_ready = True
        print("[GateKeep] Detection model ready.")
    except Exception as e:
        print(f"[GateKeep] Model load failed: {e}")


def _capture_loop():
    """
    Dedicated thread: reads frames from the camera as fast as possible and
    stores only the latest one. Prevents OpenCV's internal buffer from
    accumulating stale frames, which is the main cause of stream lag.
    """
    while cam_state.active:
        with cam_state.cap_lock:
            if cam_state.cap is None or not cam_state.cap.isOpened():
                break
            ret, frame = cam_state.cap.read()
        if ret and frame is not None:
            with cam_state.frame_lock:
                cam_state.latest_frame = frame
        # No sleep — drain the buffer as fast as the camera produces frames


def _get_latest_frame() -> np.ndarray | None:
    """Return a copy of the most recently captured frame."""
    with cam_state.frame_lock:
        if cam_state.latest_frame is None:
            return None
        return cam_state.latest_frame.copy()


def _save_snapshot(frame: np.ndarray, label: str) -> str:
    """Save alert snapshot to snapshots/alerts/."""
    snap_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "snapshots", "alerts")
    os.makedirs(snap_dir, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_label = label.strip().replace(" ", "_")
    path = os.path.join(snap_dir, f"{ts}_{safe_label}.jpg")
    cv2.imwrite(path, frame)
    return path


def _bbox_key(x1, y1, x2, y2):
    """Round bbox to 50-px grid — used as cooldown key for unauthorized faces."""
    return (x1 // 50, y1 // 50, x2 // 50, y2 // 50)


# Box colours per log type (BGR)
_COLORS = {
    "BANNED_ALERT":  (0,   0,   220),   # red
    "UNAUTHORIZED":  (0,   120, 255),   # orange
    "KNOWN_ENTRY":   (0,   200, 0  ),   # green
    "UNKNOWN":       (0,   200, 0  ),   # green (dim, no threat)
}


def _detection_loop():
    """
    Runs InsightFace on the latest frame in a dedicated thread.
    Handles BANNED_ONLY, ALLOWLIST_ONLY, and COMBINED detection modes.
    Writes annotated face data to cam_state.last_faces for the stream thread.
    """
    banned_cache:  list = []
    allowed_cache: list = []
    last_cache_reload = 0.0

    while cam_state.active:
        if not cam_state.model_ready:
            time.sleep(0.1)
            continue

        frame = _get_latest_frame()
        if frame is None:
            time.sleep(0.05)
            continue

        now  = time.time()
        mode = cam_state.mode

        # Reload face caches every 30 s
        if now - last_cache_reload > 30.0:
            banned_cache  = db.get_banned_embeddings()
            allowed_cache = db.get_allowed_embeddings()
            last_cache_reload = now

        try:
            raw_faces = matcher.get_embeddings_from_frame(frame)
            new_faces = []

            for face in raw_faces:
                if face["det_score"] < 0.5:
                    continue

                x1, y1, x2, y2 = [int(v) for v in face["bbox"]]
                emb = face["embedding"]

                banned_match  = None
                allowed_match = None

                if mode in ("BANNED_ONLY", "COMBINED"):
                    banned_match = matcher.match_against_banned(
                        emb, banned_cache, cam_state.threshold)

                if mode in ("ALLOWLIST_ONLY", "COMBINED"):
                    allowed_match = matcher.match_against_banned(
                        emb, allowed_cache, cam_state.threshold)

                # ── Classify face ──────────────────────────────────────
                if banned_match and mode in ("BANNED_ONLY", "COMBINED"):
                    log_type = "BANNED_ALERT"
                    label    = f"BANNED: {banned_match['name']} ({banned_match['similarity']:.2f})"
                    face_id  = banned_match["id"]

                    if now - cam_state.alert_times.get(face_id, 0.0) >= ALERT_COOLDOWN:
                        cam_state.alert_times[face_id] = now
                        snap_path = _save_snapshot(frame, f"BANNED_{banned_match['name']}")
                        db.log_detection(
                            matched_id=face_id,
                            matched_name=banned_match["name"],
                            similarity=banned_match["similarity"],
                            snapshot_path=snap_path,
                            camera_id=f"cam{cam_state.camera_id}",
                            log_type="BANNED_ALERT",
                            detection_mode=mode,
                        )
                        print(f"[GateKeep] BANNED_ALERT — {banned_match['name']} "
                              f"({banned_match['similarity']:.3f})")

                elif allowed_match and mode in ("ALLOWLIST_ONLY", "COMBINED"):
                    log_type = "KNOWN_ENTRY"
                    label    = f"ALLOWED: {allowed_match['name']} ({allowed_match['similarity']:.2f})"
                    face_id  = allowed_match["id"]

                    if now - cam_state.known_entry_times.get(face_id, 0.0) >= ALERT_COOLDOWN:
                        cam_state.known_entry_times[face_id] = now
                        db.log_detection(
                            matched_id=face_id,
                            matched_name=allowed_match["name"],
                            similarity=allowed_match["similarity"],
                            snapshot_path="",
                            camera_id=f"cam{cam_state.camera_id}",
                            log_type="KNOWN_ENTRY",
                            detection_mode=mode,
                        )
                        print(f"[GateKeep] KNOWN_ENTRY — {allowed_match['name']}")

                elif mode in ("ALLOWLIST_ONLY", "COMBINED"):
                    # Not banned, not allowed → unauthorized
                    log_type  = "UNAUTHORIZED"
                    label     = f"UNAUTHORIZED ({face['det_score']:.2f})"
                    bbox_key  = _bbox_key(x1, y1, x2, y2)

                    if now - cam_state.unauthorized_times.get(bbox_key, 0.0) >= ALERT_COOLDOWN:
                        cam_state.unauthorized_times[bbox_key] = now
                        snap_path = _save_snapshot(frame, "UNAUTHORIZED")
                        db.log_detection(
                            matched_id=None,
                            matched_name="",
                            similarity=0.0,
                            snapshot_path=snap_path,
                            camera_id=f"cam{cam_state.camera_id}",
                            log_type="UNAUTHORIZED",
                            detection_mode=mode,
                        )
                        print(f"[GateKeep] UNAUTHORIZED face detected")

                else:
                    # BANNED_ONLY with no banned match
                    log_type = "UNKNOWN"
                    label    = f"Unknown ({face['det_score']:.2f})"

                new_faces.append({
                    "bbox":     (x1, y1, x2, y2),
                    "label":    label,
                    "color":    _COLORS.get(log_type, (0, 200, 0)),
                    "log_type": log_type,
                })

            with cam_state.faces_lock:
                cam_state.last_faces = new_faces

        except Exception as e:
            print(f"[GateKeep] Detection error: {e}")

        time.sleep(0.05)


def _mjpeg_generator():
    """
    Stream thread: grabs the latest frame, overlays the last known detection
    boxes (never blocks waiting for detection), and yields MJPEG bytes.
    """
    boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"

    while cam_state.active:
        frame = _get_latest_frame()
        if frame is None:
            time.sleep(0.02)
            continue

        if not cam_state.model_ready:
            cv2.putText(frame, "Model loading...", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 0), 1, cv2.LINE_AA)
        else:
            with cam_state.faces_lock:
                faces = list(cam_state.last_faces)
            for f in faces:
                x1, y1, x2, y2 = f["bbox"]
                cv2.rectangle(frame, (x1, y1), (x2, y2), f["color"], 2)
                cv2.putText(frame, f["label"], (x1, max(0, y1 - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, f["color"], 1, cv2.LINE_AA)

        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        yield boundary + buf.tobytes() + b"\r\n"
        time.sleep(0.033)   # ~30 fps cap


@app.get("/api/stream")
def stream_camera():
    if not cam_state.active:
        raise HTTPException(status_code=400,
                            detail="Camera not started. POST /api/camera/start first.")
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


class CameraStartBody(BaseModel):
    camera_id: Optional[int] = 0
    threshold: Optional[float] = 0.45


@app.on_event("startup")
def on_startup():
    """Pre-warm InsightFace on server start."""
    import db as _db
    print(f"[GateKeep] Database  : {_db.DB_PATH}")
    print(f"[GateKeep] Snapshots : {SNAPSHOTS_DIR}")
    threading.Thread(target=_warm_model, daemon=True).start()


@app.post("/api/camera/start")
def start_camera(body: CameraStartBody):
    with cam_state.cap_lock:
        if cam_state.active:
            return {"status": "already_running", "camera_id": body.camera_id}
        cap = cv2.VideoCapture(body.camera_id)
        if not cap.isOpened():
            raise HTTPException(status_code=500,
                                detail=f"Cannot open camera {body.camera_id}")
        # Keep only 1 frame in the buffer to minimise latency
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        # Lower resolution = less data to process and encode each frame
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cam_state.cap                 = cap
        cam_state.active              = True
        cam_state.threshold           = body.threshold
        cam_state.camera_id           = body.camera_id
        cam_state.alert_times         = {}
        cam_state.known_entry_times   = {}
        cam_state.unauthorized_times  = {}

    with cam_state.faces_lock:
        cam_state.last_faces = []
    with cam_state.frame_lock:
        cam_state.latest_frame = None

    # Spawn dedicated capture + detection threads
    threading.Thread(target=_capture_loop,   daemon=True).start()
    threading.Thread(target=_detection_loop, daemon=True).start()

    return {"status": "started", "camera_id": body.camera_id}


@app.post("/api/camera/stop")
def stop_camera():
    cam_state.active = False
    with cam_state.cap_lock:
        if cam_state.cap:
            cam_state.cap.release()
            cam_state.cap = None
    with cam_state.faces_lock:
        cam_state.last_faces = []
    return {"status": "stopped"}


@app.get("/api/camera/status")
def camera_status():
    return {
        "active":      cam_state.active,
        "threshold":   cam_state.threshold,
        "model_ready": cam_state.model_ready,
    }


# ── HEALTH ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.datetime.now().isoformat(timespec="seconds")}


# ── BANNED LIST ───────────────────────────────────────────────────────────────

@app.get("/api/banned")
def get_banned():
    faces = db.get_all_banned_faces()
    # Don't send 512-d embeddings to the frontend — waste of bandwidth
    return [{k: v for k, v in f.items() if k != "embedding"} for f in faces]


@app.delete("/api/banned/{face_id}")
def delete_banned(face_id: int):
    face = db.get_banned_face_by_id(face_id)
    if not face:
        raise HTTPException(status_code=404, detail="Face not found")
    db.delete_banned_face(face_id)
    return {"deleted": True, "name": face["name"]}


# ── ENROLL ────────────────────────────────────────────────────────────────────

@app.get("/api/allowed")
def get_allowed():
    faces = db.get_all_allowed_faces()
    return [{k: v for k, v in f.items() if k != "embedding"} for f in faces]


@app.delete("/api/allowed/{face_id}")
def delete_allowed(face_id: int):
    face = db.get_allowed_face_by_id(face_id)
    if not face:
        raise HTTPException(status_code=404, detail="Face not found")
    db.delete_allowed_face(face_id)
    return {"deleted": True, "name": face["name"]}


class SetModeBody(BaseModel):
    mode: str


@app.get("/api/mode")
def get_mode():
    return {"mode": cam_state.mode}


@app.post("/api/mode")
async def set_mode(body: SetModeBody, token: str = Depends(require_admin)):
    valid = {"BANNED_ONLY", "ALLOWLIST_ONLY", "COMBINED"}
    if body.mode not in valid:
        raise HTTPException(status_code=400, detail=f"Mode must be one of {valid}")
    cam_state.mode = body.mode
    db.set_detection_mode(body.mode)
    # Reset all cooldown timers when switching modes
    cam_state.alert_times        = {}
    cam_state.known_entry_times  = {}
    cam_state.unauthorized_times = {}
    return {"mode": cam_state.mode}


@app.post("/api/enroll", status_code=201)
async def enroll_face(
    name: str = Form(...),
    notes: str = Form(default=""),
    list_type: str = Form(default="banned"),   # "banned" | "allowed"
    image: UploadFile = File(...)
):
    if not name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")

    # Read uploaded file into a numpy array
    contents = await image.read()
    np_arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    faces = matcher.get_embeddings_from_frame(frame)
    if not faces:
        raise HTTPException(status_code=422, detail="No face detected in the image. Try a clearer photo.")

    best_face = max(faces, key=lambda f: f["det_score"])
    embedding = best_face["embedding"]

    # Save reference image
    target = list_type.lower() if list_type.lower() in ("banned", "allowed") else "banned"
    snap_dir = os.path.abspath(
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "snapshots", "enroll", target)
    )
    os.makedirs(snap_dir, exist_ok=True)
    safe_name = name.strip().replace(" ", "_")
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    save_path = os.path.join(snap_dir, f"{ts}_{safe_name}.jpg")
    cv2.imwrite(save_path, frame)

    if target == "allowed":
        face_id = db.add_allowed_face(
            name=name.strip(), embedding=embedding,
            notes=notes.strip(), image_path=save_path,
        )
    else:
        face_id = db.add_banned_face(
            name=name.strip(), embedding=embedding,
            notes=notes.strip(), image_path=save_path,
        )

    return {
        "id":        face_id,
        "name":      name.strip(),
        "list_type": target,
        "det_score": round(best_face["det_score"], 3),
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
def get_logs(limit: int = 50, alerts_only: bool = False, log_type: str = None):
    """
    log_type filter: BANNED_ALERT | UNAUTHORIZED | KNOWN_ENTRY | UNKNOWN | alerts (banned+unauth)
    alerts_only: shorthand for log_type=alerts
    """
    if log_type == "alerts" or alerts_only:
        logs = db.get_recent_logs(limit=limit, log_types=list(LOG_TYPE_ALERTS))
    elif log_type and log_type != "all":
        logs = db.get_recent_logs(limit=limit, log_types=[log_type])
    else:
        logs = db.get_recent_logs(limit=limit)
    return [_add_snapshot_url(l) for l in logs]


# ── SNAPSHOT EXPORT ───────────────────────────────────────────────────────────

class ExportBody(BaseModel):
    # relative paths like "alerts/20260513_123456_Name.jpg"
    paths: List[str]

@app.post("/api/snapshots/export")
async def export_snapshots(body: ExportBody, token: str = Depends(require_admin)):
    """Package requested snapshots into a ZIP and stream it back."""
    buf = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in body.paths:
            # Strip any leading /snapshots/ prefix the frontend may send
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


# ── LIVE SNAPSHOT (single annotated JPEG for dashboard mini preview) ──────────

@app.get("/api/snapshot")
def get_snapshot():
    """Return the latest annotated frame as a single JPEG — lightweight dashboard preview."""
    frame = _get_latest_frame()
    if frame is None:
        raise HTTPException(status_code=503, detail="No frame available.")

    if cam_state.model_ready:
        with cam_state.faces_lock:
            faces = list(cam_state.last_faces)
        for f in faces:
            x1, y1, x2, y2 = f["bbox"]
            cv2.rectangle(frame, (x1, y1), (x2, y2), f["color"], 2)
            cv2.putText(frame, f["label"], (x1, max(0, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, f["color"], 1, cv2.LINE_AA)
    else:
        cv2.putText(frame, "Model loading...", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 0), 1, cv2.LINE_AA)

    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return Response(
        content=buf.tobytes(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


# ── DASHBOARD STATS ───────────────────────────────────────────────────────────

def _realtime_threat() -> str:
    """
    Mode-aware real-time threat level.
    BANNED_ONLY   — driven by banned face detections
    ALLOWLIST_ONLY — driven by unauthorized entries
    COMBINED       — banned takes priority; unauthorized contributes
    """
    if not cam_state.active:
        return "NOMINAL"

    mode = cam_state.mode
    now  = time.time()

    banned_secs = None
    if cam_state.alert_times:
        banned_secs = now - max(cam_state.alert_times.values())

    unauth_secs = None
    if cam_state.unauthorized_times:
        unauth_secs = now - max(cam_state.unauthorized_times.values())

    if mode == "BANNED_ONLY":
        if banned_secs is None:      return "NOMINAL"
        if banned_secs <= 10:        return "CRITICAL"
        if banned_secs <= 60:        return "HIGH"
        if banned_secs <= 600:       return "ELEVATED"
        return "NOMINAL"

    if mode == "ALLOWLIST_ONLY":
        if unauth_secs is None:      return "NOMINAL"
        if unauth_secs <= 10:        return "HIGH"
        if unauth_secs <= 120:       return "ELEVATED"
        return "NOMINAL"

    # COMBINED — banned takes priority
    if banned_secs is not None:
        if banned_secs <= 10:        return "CRITICAL"
        if banned_secs <= 60:        return "HIGH"
    if unauth_secs is not None:
        if unauth_secs <= 10:        return "HIGH"
        if unauth_secs <= 120:       return "ELEVATED"
    if banned_secs is not None and banned_secs <= 600:
        return "ELEVATED"
    return "NOMINAL"


@app.get("/api/stats")
def get_stats():
    banned  = db.get_all_banned_faces()
    allowed = db.get_all_allowed_faces()
    logs    = db.get_recent_logs(limit=500)

    cutoff = (datetime.datetime.now() - datetime.timedelta(hours=24)).isoformat(timespec="seconds")
    recent = [l for l in logs if l.get("timestamp", "") >= cutoff]

    def count_type(records, lt):
        return sum(1 for l in records if l.get("log_type") == lt)

    return {
        "banned_count":         len(banned),
        "allowed_count":        len(allowed),
        "detection_mode":       cam_state.mode,
        "total_detections":     len(logs),
        "total_alerts":         count_type(logs,   "BANNED_ALERT"),
        "alerts_last_24h":      count_type(recent, "BANNED_ALERT"),
        "unauthorized_last_24h": count_type(recent, "UNAUTHORIZED"),
        "known_entries_last_24h": count_type(recent, "KNOWN_ENTRY"),
        "camera_active":        cam_state.active,
        "current_threat":       _realtime_threat(),
    }
