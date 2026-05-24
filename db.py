"""
GateKeep — SQLite persistence layer (session-aware multi-user version).
Each visitor gets a session_id (UUID) stored in their browser.
All data is scoped to that session_id.
"""

import sqlite3
import json
import datetime
import hashlib
import os

# Allow GATEKEEP_DATA_DIR env var to redirect to a persistent volume (Render disk)
_data_dir = os.environ.get("GATEKEEP_DATA_DIR") or os.path.dirname(__file__)
DB_PATH = os.path.abspath(os.path.join(_data_dir, "gatekeep.db"))


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as conn:
        # ── Core tables ───────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS banned_faces (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL DEFAULT 'default',
                name        TEXT NOT NULL,
                notes       TEXT DEFAULT '',
                embedding   TEXT NOT NULL,
                added_at    TEXT NOT NULL,
                image_path  TEXT DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS allowed_faces (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL DEFAULT 'default',
                name        TEXT NOT NULL,
                notes       TEXT DEFAULT '',
                embedding   TEXT NOT NULL,
                added_at    TEXT NOT NULL,
                image_path  TEXT DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS detection_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      TEXT NOT NULL DEFAULT 'default',
                timestamp       TEXT NOT NULL,
                matched_id      INTEGER,
                matched_name    TEXT DEFAULT '',
                similarity      REAL DEFAULT 0.0,
                snapshot_path   TEXT DEFAULT '',
                camera_id       TEXT DEFAULT 'browser',
                log_type        TEXT DEFAULT 'UNKNOWN',
                detection_mode  TEXT DEFAULT 'BANNED_ONLY'
            )
        """)
        # ── Per-session config (mode, threshold, etc.) ────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS session_config (
                session_id  TEXT NOT NULL,
                key         TEXT NOT NULL,
                value       TEXT NOT NULL,
                PRIMARY KEY (session_id, key)
            )
        """)
        # ── Global admin config ───────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS admin_config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        # Use ADMIN_PASSWORD env var if set; fall back to 'admin' for local dev only
        default_pw   = os.environ.get("ADMIN_PASSWORD", "admin").encode("utf-8")
        default_hash = hashlib.sha256(default_pw).hexdigest()
        conn.execute(
            "INSERT OR IGNORE INTO admin_config (key, value) VALUES (?, ?)",
            ('password_hash', default_hash)
        )

        # ── Migrate old columns if upgrading from personal version ─
        for table in ('banned_faces', 'allowed_faces', 'detection_log'):
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN session_id TEXT DEFAULT 'default'")
            except Exception:
                pass
        for col, default in [('log_type', 'UNKNOWN'), ('detection_mode', 'BANNED_ONLY')]:
            try:
                conn.execute(f"ALTER TABLE detection_log ADD COLUMN {col} TEXT DEFAULT '{default}'")
            except Exception:
                pass

        conn.commit()


# ── SESSION CONFIG ────────────────────────────────────────────────────────────

def get_session_mode(session_id: str) -> str:
    with _conn() as conn:
        row = conn.execute(
            "SELECT value FROM session_config WHERE session_id=? AND key='mode'",
            (session_id,)
        ).fetchone()
    return row['value'] if row else 'BANNED_ONLY'


def set_session_mode(session_id: str, mode: str):
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO session_config (session_id, key, value) VALUES (?, 'mode', ?)",
            (session_id, mode)
        )
        conn.commit()


def get_session_threshold(session_id: str) -> float:
    with _conn() as conn:
        row = conn.execute(
            "SELECT value FROM session_config WHERE session_id=? AND key='threshold'",
            (session_id,)
        ).fetchone()
    return float(row['value']) if row else 0.45


def set_session_threshold(session_id: str, threshold: float):
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO session_config (session_id, key, value) VALUES (?, 'threshold', ?)",
            (session_id, str(threshold))
        )
        conn.commit()


# ── BANNED FACES ──────────────────────────────────────────────────────────────

def add_banned_face(session_id: str, name: str, embedding: list,
                    notes: str = "", image_path: str = "") -> int:
    embedding = [float(v) for v in embedding]
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO banned_faces (session_id, name, notes, embedding, added_at, image_path) VALUES (?,?,?,?,?,?)",
            (session_id, name, notes, json.dumps(embedding), _now(), image_path)
        )
        conn.commit()
        return cur.lastrowid


def get_all_banned_faces(session_id: str) -> list:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM banned_faces WHERE session_id=?", (session_id,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_banned_face_by_id(face_id: int, session_id: str) -> dict:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM banned_faces WHERE id=? AND session_id=?", (face_id, session_id)
        ).fetchone()
    return _row_to_dict(row) if row else None


def delete_banned_face(face_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM banned_faces WHERE id=?", (face_id,))
        conn.commit()
    return cur.rowcount > 0


def get_banned_embeddings(session_id: str) -> list:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, name, embedding FROM banned_faces WHERE session_id=?", (session_id,)
        ).fetchall()
    return [(r["id"], r["name"], json.loads(r["embedding"])) for r in rows]


# ── ALLOWED FACES ─────────────────────────────────────────────────────────────

def add_allowed_face(session_id: str, name: str, embedding: list,
                     notes: str = "", image_path: str = "") -> int:
    embedding = [float(v) for v in embedding]
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO allowed_faces (session_id, name, notes, embedding, added_at, image_path) VALUES (?,?,?,?,?,?)",
            (session_id, name, notes, json.dumps(embedding), _now(), image_path)
        )
        conn.commit()
        return cur.lastrowid


def get_all_allowed_faces(session_id: str) -> list:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM allowed_faces WHERE session_id=?", (session_id,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_allowed_face_by_id(face_id: int, session_id: str) -> dict:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM allowed_faces WHERE id=? AND session_id=?", (face_id, session_id)
        ).fetchone()
    return _row_to_dict(row) if row else None


def delete_allowed_face(face_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM allowed_faces WHERE id=?", (face_id,))
        conn.commit()
    return cur.rowcount > 0


def get_allowed_embeddings(session_id: str) -> list:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, name, embedding FROM allowed_faces WHERE session_id=?", (session_id,)
        ).fetchall()
    return [(r["id"], r["name"], json.loads(r["embedding"])) for r in rows]


# ── DETECTION LOG ─────────────────────────────────────────────────────────────

def log_detection(session_id: str = "default", matched_id=None, matched_name="",
                  similarity=0.0, snapshot_path="", camera_id="browser",
                  log_type="UNKNOWN", detection_mode="BANNED_ONLY") -> int:
    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO detection_log
               (session_id, timestamp, matched_id, matched_name, similarity,
                snapshot_path, camera_id, log_type, detection_mode)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (session_id, _now(), matched_id, matched_name, similarity,
             snapshot_path, camera_id, log_type, detection_mode)
        )
        conn.commit()
        return cur.lastrowid


def get_recent_logs(session_id: str = "default", limit: int = 50,
                    log_types: list = None) -> list:
    with _conn() as conn:
        if log_types:
            placeholders = ','.join('?' * len(log_types))
            rows = conn.execute(
                f"SELECT * FROM detection_log WHERE session_id=? AND log_type IN ({placeholders}) ORDER BY timestamp DESC LIMIT ?",
                (session_id, *log_types, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM detection_log WHERE session_id=? ORDER BY timestamp DESC LIMIT ?",
                (session_id, limit)
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def clear_detection_log(session_id: str = "default", log_type: str = None):
    with _conn() as conn:
        if log_type:
            conn.execute(
                "DELETE FROM detection_log WHERE session_id=? AND log_type=?",
                (session_id, log_type)
            )
        else:
            conn.execute("DELETE FROM detection_log WHERE session_id=?", (session_id,))
        conn.commit()


# ── ADMIN CONFIG ──────────────────────────────────────────────────────────────

def get_admin_password_hash() -> str:
    with _conn() as conn:
        row = conn.execute(
            "SELECT value FROM admin_config WHERE key='password_hash'"
        ).fetchone()
    return row['value'] if row else ''


def set_admin_password_hash(new_hash: str):
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO admin_config (key, value) VALUES ('password_hash', ?)",
            (new_hash,)
        )
        conn.commit()


# ── HELPERS ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _row_to_dict(row) -> dict:
    if row is None:
        return None
    d = dict(row)
    if "embedding" in d and isinstance(d["embedding"], str):
        d["embedding"] = json.loads(d["embedding"])
    return d
