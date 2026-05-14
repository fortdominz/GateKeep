"""
GateKeep — SQLite persistence layer.
Stores face embeddings for the banned list.
Embeddings are stored as JSON-serialized lists (float arrays).
"""

import sqlite3
import json
import datetime
import hashlib
import os

# Always resolve to an absolute path so the DB is found regardless of CWD
DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "gatekeep.db"))


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they don't exist."""
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS banned_faces (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
                timestamp       TEXT NOT NULL,
                matched_id      INTEGER,
                matched_name    TEXT DEFAULT '',
                similarity      REAL DEFAULT 0.0,
                snapshot_path   TEXT DEFAULT '',
                camera_id       TEXT DEFAULT 'cam0',
                log_type        TEXT DEFAULT 'UNKNOWN',
                detection_mode  TEXT DEFAULT 'BANNED_ONLY'
            )
        """)
        # Migrate existing detection_log rows — add columns if missing
        for col, default in [('log_type', 'UNKNOWN'), ('detection_mode', 'BANNED_ONLY')]:
            try:
                conn.execute(f"ALTER TABLE detection_log ADD COLUMN {col} TEXT DEFAULT '{default}'")
            except Exception:
                pass  # Column already exists

        conn.execute("""
            CREATE TABLE IF NOT EXISTS admin_config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        default_hash = hashlib.sha256(b'admin').hexdigest()
        conn.execute(
            "INSERT OR IGNORE INTO admin_config (key, value) VALUES (?, ?)",
            ('password_hash', default_hash)
        )
        # Default detection mode
        conn.execute(
            "INSERT OR IGNORE INTO admin_config (key, value) VALUES (?, ?)",
            ('detection_mode', 'BANNED_ONLY')
        )
        conn.commit()


# ── BANNED FACES ─────────────────────────────────────────────────────────────

def add_banned_face(name: str, embedding: list, notes: str = "", image_path: str = "") -> int:
    # Ensure all values are plain Python floats (numpy float32 is not JSON-serializable)
    embedding = [float(v) for v in embedding]
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO banned_faces (name, notes, embedding, added_at, image_path) VALUES (?, ?, ?, ?, ?)",
            (name, notes, json.dumps(embedding), _now(), image_path)
        )
        conn.commit()
        return cur.lastrowid


def get_all_banned_faces() -> list:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM banned_faces").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_banned_face_by_id(face_id: int):
    with _conn() as conn:
        row = conn.execute("SELECT * FROM banned_faces WHERE id = ?", (face_id,)).fetchone()
    return _row_to_dict(row) if row else None


def delete_banned_face(face_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM banned_faces WHERE id = ?", (face_id,))
        conn.commit()
    return cur.rowcount > 0


def get_banned_embeddings() -> list:
    """Returns list of (id, name, embedding_list) tuples — used by matcher."""
    with _conn() as conn:
        rows = conn.execute("SELECT id, name, embedding FROM banned_faces").fetchall()
    return [(r["id"], r["name"], json.loads(r["embedding"])) for r in rows]


# ── ALLOWED FACES ────────────────────────────────────────────────────────────

def add_allowed_face(name: str, embedding: list, notes: str = "", image_path: str = "") -> int:
    embedding = [float(v) for v in embedding]
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO allowed_faces (name, notes, embedding, added_at, image_path) VALUES (?, ?, ?, ?, ?)",
            (name, notes, json.dumps(embedding), _now(), image_path)
        )
        conn.commit()
        return cur.lastrowid


def get_all_allowed_faces() -> list:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM allowed_faces").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_allowed_face_by_id(face_id: int):
    with _conn() as conn:
        row = conn.execute("SELECT * FROM allowed_faces WHERE id = ?", (face_id,)).fetchone()
    return _row_to_dict(row) if row else None


def delete_allowed_face(face_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM allowed_faces WHERE id = ?", (face_id,))
        conn.commit()
    return cur.rowcount > 0


def get_allowed_embeddings() -> list:
    with _conn() as conn:
        rows = conn.execute("SELECT id, name, embedding FROM allowed_faces").fetchall()
    return [(r["id"], r["name"], json.loads(r["embedding"])) for r in rows]


# ── DETECTION LOG ────────────────────────────────────────────────────────────

def log_detection(matched_id=None, matched_name="", similarity=0.0,
                  snapshot_path="", camera_id="cam0",
                  log_type="UNKNOWN", detection_mode="BANNED_ONLY") -> int:
    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO detection_log
               (timestamp, matched_id, matched_name, similarity,
                snapshot_path, camera_id, log_type, detection_mode)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (_now(), matched_id, matched_name, similarity,
             snapshot_path, camera_id, log_type, detection_mode)
        )
        conn.commit()
        return cur.lastrowid


def get_recent_logs(limit: int = 50, log_types: list = None) -> list:
    with _conn() as conn:
        if log_types:
            placeholders = ','.join('?' * len(log_types))
            rows = conn.execute(
                f"SELECT * FROM detection_log WHERE log_type IN ({placeholders}) ORDER BY timestamp DESC LIMIT ?",
                (*log_types, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM detection_log ORDER BY timestamp DESC LIMIT ?", (limit,)
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


# ── DETECTION MODE ───────────────────────────────────────────────────────────

def get_detection_mode() -> str:
    with _conn() as conn:
        row = conn.execute(
            "SELECT value FROM admin_config WHERE key='detection_mode'"
        ).fetchone()
    return row['value'] if row else 'BANNED_ONLY'


def set_detection_mode(mode: str):
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO admin_config (key, value) VALUES ('detection_mode', ?)",
            (mode,)
        )
        conn.commit()


# ── ADMIN CONFIG ─────────────────────────────────────────────────────────────

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


def clear_detection_log(log_type: str = None):
    """Clear all logs, or only logs of a specific type."""
    with _conn() as conn:
        if log_type:
            conn.execute("DELETE FROM detection_log WHERE log_type = ?", (log_type,))
        else:
            conn.execute("DELETE FROM detection_log")
        conn.commit()


# ── HELPERS ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _row_to_dict(row) -> dict:
    if row is None:
        return None
    d = dict(row)
    # Deserialize embedding if present
    if "embedding" in d and isinstance(d["embedding"], str):
        d["embedding"] = json.loads(d["embedding"])
    return d
