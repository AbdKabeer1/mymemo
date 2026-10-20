"""Storage for MyMemo.

Local dev  -> SQLite at data/mymemo.db
Production -> Turso / libSQL over HTTP (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)

Every player-owned row is scoped by `client_id` — an anonymous per-browser id
generated client-side (see static/js/app.js). The `words` curriculum is global
and read-only.
"""
import base64
import datetime
import json
import os
import sqlite3
import urllib.request

from seed_data import LEVELS, THEMES, WORDS

TURSO_URL = os.environ.get("TURSO_DATABASE_URL", "").strip()
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "").strip()


def is_remote():
    return bool(TURSO_URL and TURSO_TOKEN)


def _http_url():
    url = TURSO_URL
    if url.startswith("libsql://"):
        url = "https://" + url[len("libsql://"):]
    return url.rstrip("/")


# --------------------------------------------------------------------------
# Turso HTTP client (Hrana pipeline protocol, no extra dependencies)
# --------------------------------------------------------------------------
def _enc(value):
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": str(int(value))}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, bytes):
        return {"type": "blob", "value": base64.b64encode(value).decode()}
    return {"type": "text", "value": str(value)}


def _dec(cell):
    kind, value = cell.get("type"), cell.get("value")
    if kind == "null":
        return None
    if kind == "integer":
        return int(value)
    if kind == "float":
        return float(value)
    if kind == "blob":
        return base64.b64decode(value)
    return value


def _post(requests):
    body = json.dumps({"requests": requests}).encode()
    req = urllib.request.Request(
        _http_url() + "/v2/pipeline", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + TURSO_TOKEN})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    for res in data.get("results", []):
        if res.get("type") == "error":
            raise RuntimeError((res.get("error") or {}).get("message", "Turso error"))
    return data


class Cursor:
    def __init__(self, rows, rowcount=0, lastrowid=None):
        self._rows = rows
        self.rowcount = rowcount
        self.lastrowid = lastrowid

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class TursoConn:
    """Minimal DB-API-ish wrapper: execute / execute_many / commit."""

    def execute(self, sql, args=()):
        return self.execute_many([(sql, args)])[0]

    def execute_many(self, stmts, chunk=120):
        cursors = []
        for i in range(0, len(stmts), chunk):
            part = stmts[i:i + chunk]
            requests = [{
                "type": "execute",
                "stmt": {"sql": sql,
                         "args": [_enc(a) for a in (args or ())],
                         "want_rows": True},
            } for sql, args in part]
            data = _post(requests)
            for res in data.get("results", []):
                result = (res.get("response") or {}).get("result") or {}
                cols = [c.get("name") for c in (result.get("cols") or [])]
                rows = [dict(zip(cols, [_dec(c) for c in row]))
                        for row in (result.get("rows") or [])]
                cursors.append(Cursor(rows,
                                      result.get("affected_row_count", 0),
                                      result.get("last_insert_rowid")))
        return cursors

    def commit(self):
        pass

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def connect(db_path):
    if is_remote():
        return TursoConn()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def execute_many(conn, stmts, chunk=120):
    """Run [(sql, args)] atomically enough for seeding; returns Cursor list."""
    if isinstance(conn, TursoConn):
        return conn.execute_many(stmts, chunk)
    cursors = []
    for sql, args in stmts:
        cur = conn.execute(sql, args)
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        cursors.append(Cursor(rows, cur.rowcount, cur.lastrowid))
    conn.commit()
    return cursors


SCHEMA = [
    """CREATE TABLE IF NOT EXISTS words (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        finnish TEXT NOT NULL UNIQUE,
        english TEXT NOT NULL,
        level   TEXT NOT NULL,
        theme   TEXT NOT NULL,
        source  TEXT NOT NULL DEFAULT 'seed'
    )""",
    """CREATE TABLE IF NOT EXISTS my_words (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id     TEXT NOT NULL DEFAULT 'local',
        finnish       TEXT NOT NULL,
        english       TEXT NOT NULL,
        level         TEXT NOT NULL DEFAULT 'B1',
        theme         TEXT NOT NULL DEFAULT 'custom',
        correct_count INTEGER NOT NULL DEFAULT 0,
        wrong_count   INTEGER NOT NULL DEFAULT 0,
        box           INTEGER NOT NULL DEFAULT 0,
        due_at        TEXT,
        last_seen     TEXT,
        created_at    TEXT NOT NULL,
        UNIQUE (client_id, finnish)
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  TEXT NOT NULL DEFAULT 'local',
        mode       TEXT NOT NULL,
        level      TEXT,
        direction  TEXT,
        score      INTEGER NOT NULL DEFAULT 0,
        correct    INTEGER NOT NULL DEFAULT 0,
        total      INTEGER NOT NULL DEFAULT 0,
        wrong_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS settings (
        client_id TEXT NOT NULL DEFAULT 'local',
        key       TEXT NOT NULL,
        value     TEXT NOT NULL,
        PRIMARY KEY (client_id, key)
    )""",
    """CREATE TABLE IF NOT EXISTS users (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        username  TEXT NOT NULL UNIQUE,
        pass_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
]


MY_WORDS_NEW_DDL = """CREATE TABLE IF NOT EXISTS my_words_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     TEXT NOT NULL DEFAULT 'local',
    finnish       TEXT NOT NULL,
    english       TEXT NOT NULL,
    level         TEXT NOT NULL DEFAULT 'B1',
    theme         TEXT NOT NULL DEFAULT 'custom',
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count   INTEGER NOT NULL DEFAULT 0,
    box           INTEGER NOT NULL DEFAULT 0,
    due_at        TEXT,
    last_seen     TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE (client_id, finnish)
)"""


def _migrate_my_words_unique(conn):
    """Legacy local DBs had UNIQUE(finnish); rebuild with UNIQUE(client_id, finnish)."""
    for idx in conn.execute("PRAGMA index_list(my_words)").fetchall():
        if not idx["unique"]:
            continue
        cols = [r["name"] for r in conn.execute(
            "PRAGMA index_info('%s')" % idx["name"])]
        if cols == ["finnish"]:
            conn.execute("DROP TABLE IF EXISTS my_words_new")
            conn.execute(MY_WORDS_NEW_DDL)
            conn.execute(
                "INSERT INTO my_words_new (id, client_id, finnish, english, level, theme,"
                " correct_count, wrong_count, box, due_at, last_seen, created_at)"
                " SELECT id, client_id, finnish, english, level, theme,"
                " correct_count, wrong_count, box, due_at, last_seen, created_at"
                " FROM my_words")
            conn.execute("DROP TABLE my_words")
            conn.execute("ALTER TABLE my_words_new RENAME TO my_words")
            conn.commit()
            return


def init(db_path):
    conn = connect(db_path)
    if is_remote():
        # one HTTP round-trip for the whole schema
        conn.execute_many([(stmt, ()) for stmt in SCHEMA])
    else:
        for stmt in SCHEMA:
            conn.execute(stmt)
        # Migrate older local DBs (add columns; SQLite only — remote DB starts fresh)
        for table, columns in {
            "my_words": [("client_id", "TEXT NOT NULL DEFAULT 'local'"),
                         ("box", "INTEGER NOT NULL DEFAULT 0"),
                         ("due_at", "TEXT"),
                         ("last_seen", "TEXT")],
            "sessions": [("client_id", "TEXT NOT NULL DEFAULT 'local'")],
            "settings": [("client_id", "TEXT NOT NULL DEFAULT 'local'")],
        }.items():
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            for name, ddl in columns:
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        _migrate_my_words_unique(conn)
        # legacy anonymous scope before accounts existed
        for table in ("my_words", "sessions", "settings"):
            conn.execute(f"UPDATE {table} SET client_id = 'b:local'"
                         f" WHERE client_id = 'local'")
        conn.commit()

    have = count_words(conn)
    if have < len(WORDS):
        execute_many(conn, [
            ("INSERT OR IGNORE INTO words (finnish, english, level, theme, source)"
             " VALUES (?, ?, ?, ?, 'seed')", (f, e, lv, th))
            for f, e, lv, th in WORDS
        ])
    conn.commit()


def now_iso():
    return datetime.datetime.utcnow().isoformat(timespec="seconds")


# ---------------------------------------------------------------- curriculum

def query_words(conn, level=None, theme=None, q=None, limit=2000):
    sql = "SELECT finnish, english, level, theme FROM words WHERE 1=1"
    args = []
    if level and level != "mixed":
        sql += " AND level = ?"
        args.append(level)
    if theme and theme != "all":
        sql += " AND theme = ?"
        args.append(theme)
    if q:
        sql += " AND (finnish LIKE ? OR english LIKE ?)"
        args += ["%" + q + "%", "%" + q + "%"]
    sql += " ORDER BY level, finnish LIMIT ?"
    args.append(max(1, min(int(limit or 2000), 5000)))
    rows = conn.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


def count_words(conn):
    return conn.execute("SELECT COUNT(*) c FROM words").fetchone()["c"]


# ---------------------------------------------------------------- auto tagging

THEME_KEYWORDS = {
    "shopping": ["money", "price", "buy", "sell", "shop", "store", "pay", "cost",
                 "discount", "receipt", "credit", "currency", "loan", "invoice",
                 "cash", "cheap", "expensive", "sale", "order", "delivery"],
    "food": ["food", "eat", "drink", "bread", "milk", "water", "coffee", "tea",
             "meat", "fish", "potato", "apple", "cheese", "salt", "sugar", "egg",
             "soup", "rice", "fruit", "vegetable", "berry", "cake", "juice",
             "beer", "wine", "restaurant", "cafe", "café", "meal", "breakfast",
             "lunch", "dinner", "snack", "butter", "flour", "onion", "garlic",
             "honey", "jam", "plate", "cup", "glass", "fork", "knife", "spoon"],
    "transport": ["bus", "train", "car", "bicycle", "bike", "plane", "ship",
                  "ticket", "station", "street", "road", "drive", "travel", "trip",
                  "airport", "ferry", "metro", "tram", "traffic", "parking",
                  "passenger", "driver", "route", "platform", "vehicle"],
    "health": ["health", "doctor", "hospital", "medicine", "sick", "ill", "pain",
               "nurse", "dentist", "pharmacy", "blood", "heart", "tooth", "teeth",
               "headache", "flu", "clinic", "treatment", "injury", "wound", "fever",
               "cough", "allergy", "vaccine", "therapy", "mental", "stress"],
    "work": ["work", "job", "salary", "employer", "employee", "office", "meeting",
             "contract", "hire", "interview", "colleague", "boss", "manager",
             "company", "project", "task", "career", "overtime", "workplace",
             "deadline", "client", "business", "team", "shift", "wage", "staff"],
    "social": ["law", "court", "government", "citizen", "social", "tax", "police",
               "city", "municipality", "benefit", "election", "society", "community",
               "permit", "registration", "official", "authority", "public",
               "neighbour", "neighbor", "immigration", "parliament", "rights"],
    "home": ["house", "home", "room", "kitchen", "door", "window", "bed", "table",
             "chair", "furniture", "floor", "wall", "lamp", "clean", "laundry",
             "key", "apartment", "flat", "sofa", "cupboard", "shelf", "towel",
             "shower", "electricity", "heating", "garden", "balcony", "stair",
             "mirror", "carpet", "curtain", "sink", "oven", "fridge"],
    "nature": ["tree", "forest", "sea", "lake", "snow", "rain", "sun", "weather",
               "wind", "cloud", "animal", "bird", "dog", "cat", "horse", "cow",
               "sheep", "fox", "bear", "wolf", "moose", "insect", "flower", "grass",
               "stone", "river", "island", "mountain", "sky", "moon", "star"],
}

LEVEL_HINTS = {"A1": 6, "A2": 8, "B1": 10, "B2": 13}


def _guess_level(finnish):
    n = len(finnish.replace("-", "").replace(" ", ""))
    if n <= 6:
        return "A1"
    if n <= 8:
        return "A2"
    if n <= 10:
        return "B1"
    if n <= 13:
        return "B2"
    return "C1"


def _guess_theme(english):
    low = " " + english.lower() + " "
    best, hits = "daily", 0
    for theme, words in THEME_KEYWORDS.items():
        count = sum(1 for w in words if " " + w in low or w + " " in low)
        if count > hits:
            best, hits = theme, count
    return best


def auto_tag(conn, finnish, english):
    """Level + theme for a word: exact curriculum match, else heuristics."""
    row = conn.execute(
        "SELECT level, theme FROM words WHERE finnish = ?", (finnish,)).fetchone()
    if row:
        return row["level"], row["theme"]
    return _guess_level(finnish), _guess_theme(english)


# ---------------------------------------------------------------- my words

def query_my_words(conn, client, q=None, limit=2000):
    sql = ("SELECT id, finnish, english, level, theme, correct_count, wrong_count,"
           " box, due_at, created_at FROM my_words WHERE client_id = ?")
    args = [client]
    if q:
        sql += " AND (finnish LIKE ? OR english LIKE ?)"
        args += ["%" + q + "%", "%" + q + "%"]
    sql += " ORDER BY created_at DESC, finnish LIMIT ?"
    args.append(max(1, min(int(limit or 2000), 5000)))
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def count_my_words(conn, client):
    return conn.execute(
        "SELECT COUNT(*) c FROM my_words WHERE client_id = ?", (client,)).fetchone()["c"]


def add_my_word(conn, client, finnish, english, level=None, theme=None):
    if not level or level not in LEVELS or not theme or theme == "custom":
        level, theme = auto_tag(conn, finnish, english)
    conn.execute(
        "INSERT OR IGNORE INTO my_words"
        " (client_id, finnish, english, level, theme, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (client, finnish, english, level, theme, now_iso()))
    conn.commit()


def delete_my_word(conn, client, word_id):
    conn.execute("DELETE FROM my_words WHERE id = ? AND client_id = ?",
                 (word_id, client))
    conn.commit()


def save_passed_words(conn, client, results):
    """Words the player spelled correctly join their personal bank."""
    added = 0
    for r in results or []:
        if not r.get("ok"):
            continue
        finnish = (r.get("finnish") or "").strip()
        english = (r.get("english") or "").strip()
        if not finnish or not english:
            continue
        cur = conn.execute(
            "INSERT OR IGNORE INTO my_words"
            " (client_id, finnish, english, level, theme, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (client, finnish, english, r.get("level") or "B1",
             r.get("theme") or "custom", now_iso()))
        added += cur.rowcount
    conn.commit()
    return added


def mastered_count(conn, client):
    return conn.execute(
        "SELECT COUNT(*) c FROM my_words WHERE client_id = ? AND box >= 3",
        (client,)).fetchone()["c"]


def due_count(conn, client):
    return conn.execute(
        "SELECT COUNT(*) c FROM my_words WHERE client_id = ?"
        " AND (due_at IS NULL OR due_at <= ?)",
        (client, now_iso())).fetchone()["c"]


def due_words(conn, client, level=None, theme=None, limit=5000):
    sql = ("SELECT finnish, english, level, theme FROM my_words"
           " WHERE client_id = ? AND (due_at IS NULL OR due_at <= ?)")
    args = [client, now_iso()]
    if level and level != "mixed":
        sql += " AND level = ?"
        args.append(level)
    if theme and theme != "all":
        sql += " AND theme = ?"
        args.append(theme)
    sql += " ORDER BY (due_at IS NULL) DESC, due_at ASC LIMIT ?"
    args.append(limit)
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def weak_words(conn, client, level=None, theme=None, limit=5000):
    sql = ("SELECT finnish, english, level, theme FROM my_words"
           " WHERE client_id = ? AND wrong_count > 0 AND box < 3")
    args = [client]
    if level and level != "mixed":
        sql += " AND level = ?"
        args.append(level)
    if theme and theme != "all":
        sql += " AND theme = ?"
        args.append(theme)
    sql += " ORDER BY wrong_count DESC, correct_count ASC LIMIT ?"
    args.append(limit)
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


BOX_DAYS = [1, 2, 4, 8, 16, 32]   # days until next review per box


def apply_results(conn, client, results):
    """Leitner-style scheduling + counters for words already in the bank."""
    now = datetime.datetime.utcnow()
    now_s = now.isoformat(timespec="seconds")
    for r in results or []:
        row = conn.execute(
            "SELECT id, box FROM my_words WHERE client_id = ? AND finnish = ?",
            (client, r.get("finnish"))).fetchone()
        if not row:
            continue
        if r.get("ok"):
            box = min(int(row["box"] or 0) + 1, 5)
            due = (now + datetime.timedelta(days=BOX_DAYS[box])).isoformat(timespec="seconds")
            conn.execute(
                "UPDATE my_words SET correct_count = correct_count + 1, box = ?,"
                " due_at = ?, last_seen = ? WHERE id = ?", (box, due, now_s, row["id"]))
        else:
            conn.execute(
                "UPDATE my_words SET wrong_count = wrong_count + 1, box = 0,"
                " due_at = ?, last_seen = ? WHERE id = ?", (now_s, now_s, row["id"]))
    conn.commit()


# ---------------------------------------------------------------- sessions

def add_session(conn, client, mode, level, direction, score, correct, total, wrong):
    conn.execute(
        "INSERT INTO sessions (client_id, mode, level, direction, score, correct,"
        " total, wrong_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (client, mode, level, direction, score, correct, total,
         _json_dumps(wrong), now_iso()))
    conn.commit()


def recent_sessions(conn, client, limit=6):
    rows = conn.execute(
        "SELECT mode, level, direction, score, correct, total, created_at"
        " FROM sessions WHERE client_id = ? ORDER BY id DESC LIMIT ?",
        (client, limit)).fetchall()
    return [dict(r) for r in rows]


def last_test_at(conn, client):
    row = conn.execute(
        "SELECT MAX(created_at) t FROM sessions WHERE client_id = ? AND mode = 'test'",
        (client,)).fetchone()
    return row["t"]


def total_xp(conn, client):
    row = conn.execute(
        "SELECT COALESCE(SUM(score), 0) s FROM sessions WHERE client_id = ?",
        (client,)).fetchone()
    return row["s"]


def session_count(conn, client):
    row = conn.execute(
        "SELECT COUNT(*) c FROM sessions WHERE client_id = ?", (client,)).fetchone()
    return row["c"]


# ---------------------------------------------------------------- accounts

def create_user(conn, username, pass_hash):
    conn.execute(
        "INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)",
        (username, pass_hash, now_iso()))
    conn.commit()
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    return row["id"]


def find_user(conn, username):
    return conn.execute(
        "SELECT id, username, pass_hash FROM users WHERE username = ?",
        (username,)).fetchone()


def find_user_by_id(conn, user_id):
    return conn.execute(
        "SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()


def merge_guest_into_user(conn, guest_scope, user_scope):
    """Registration adopts whatever the anonymous browser had collected."""
    conn.execute(
        "INSERT OR IGNORE INTO my_words"
        " (client_id, finnish, english, level, theme, correct_count, wrong_count,"
        "  box, due_at, last_seen, created_at)"
        " SELECT ?, finnish, english, level, theme, correct_count, wrong_count,"
        "        box, due_at, last_seen, created_at"
        " FROM my_words WHERE client_id = ?", (user_scope, guest_scope))
    conn.execute("DELETE FROM my_words WHERE client_id = ?", (guest_scope,))
    conn.execute("UPDATE sessions SET client_id = ? WHERE client_id = ?",
                 (user_scope, guest_scope))
    conn.execute(
        "INSERT OR REPLACE INTO settings (client_id, key, value)"
        " SELECT ?, key, value FROM settings WHERE client_id = ?",
        (user_scope, guest_scope))
    conn.execute("DELETE FROM settings WHERE client_id = ?", (guest_scope,))
    conn.commit()


# ---------------------------------------------------------------- settings

DEFAULT_SETTINGS = {
    "practiceLanguage": "finnish",
    "defaultLevel": "A1",
    "decoys": True,
    "autoSaveWrong": False,
    "testFrequency": "weekly",
    "testIntervalHours": 12,
    "darkMode": False,
}

_INT_KEYS = {"testIntervalHours"}
_BOOL_KEYS = {"decoys", "autoSaveWrong", "darkMode"}


def all_settings(conn, client):
    stored = {r["key"]: r["value"] for r in conn.execute(
        "SELECT key, value FROM settings WHERE client_id = ?", (client,)).fetchall()}
    merged = dict(DEFAULT_SETTINGS)
    for k, v in stored.items():
        if k not in merged:
            continue
        try:
            if k in _BOOL_KEYS:
                merged[k] = v == "true"
            elif k in _INT_KEYS:
                merged[k] = int(float(v))
            else:
                merged[k] = v
        except (TypeError, ValueError):
            pass
    return merged


def save_settings(conn, client, values):
    for k, v in values.items():
        if k not in DEFAULT_SETTINGS:
            continue
        if k in _INT_KEYS:
            try:
                v = str(max(1, min(int(float(v)), 24 * 30)))
            except (TypeError, ValueError):
                continue
        elif isinstance(v, bool):
            v = str(v).lower()
        conn.execute(
            "INSERT OR REPLACE INTO settings (client_id, key, value) VALUES (?, ?, ?)",
            (client, k, str(v)))
    conn.commit()


# ---------------------------------------------------------------- import / data

def import_rows(conn, client, rows, target="library", default_level=None,
                default_theme=None):
    added = skipped = 0
    for row in rows:
        if not row or len(row) < 2:
            skipped += 1
            continue
        finnish, english = str(row[0]).strip(), str(row[1]).strip()
        if not finnish or not english:
            skipped += 1
            continue
        level = str(row[2]).strip().upper() if len(row) > 2 and row[2] else None
        if level not in LEVELS:
            level = None
        theme = str(row[3]).strip() if len(row) > 3 and row[3] else None
        if theme in ("", "custom"):
            theme = None
        if not level or not theme:
            auto_level, auto_theme = auto_tag(conn, finnish, english)
            level = level or default_level or auto_level
            theme = theme or default_theme or auto_theme
        if target == "mywords":
            before = count_my_words(conn, client)
            add_my_word(conn, client, finnish, english, level, theme)
            if count_my_words(conn, client) > before:
                added += 1
            else:
                skipped += 1
        else:
            cur = conn.execute(
                "INSERT OR IGNORE INTO words (finnish, english, level, theme, source)"
                " VALUES (?, ?, ?, ?, 'import')",
                (finnish, english, level, theme))
            added += cur.rowcount
            if cur.rowcount == 0:
                skipped += 1
    conn.commit()
    return {"added": added, "skipped": skipped}


def reset(conn, client, scope):
    if scope in ("progress", "all"):
        conn.execute("DELETE FROM sessions WHERE client_id = ?", (client,))
        conn.execute("UPDATE my_words SET correct_count = 0, wrong_count = 0,"
                     " box = 0, due_at = NULL, last_seen = NULL WHERE client_id = ?",
                     (client,))
    if scope in ("mywords", "all"):
        conn.execute("DELETE FROM my_words WHERE client_id = ?", (client,))
    conn.commit()


def export_csv(conn, client):
    lines = ["finnish,english,level,theme"]
    rows = conn.execute(
        "SELECT finnish, english, level, theme FROM words"
        " ORDER BY level, theme, finnish").fetchall()
    for r in rows:
        lines.append(_csv_escape([r["finnish"], r["english"], r["level"], r["theme"]]))
    lines.append("")
    lines.append("# My Words")
    lines.append("finnish,english,level,theme,wrongCount")
    for r in conn.execute(
            "SELECT finnish, english, level, theme, wrong_count FROM my_words"
            " WHERE client_id = ? ORDER BY finnish", (client,)).fetchall():
        lines.append(_csv_escape([r["finnish"], r["english"], r["level"],
                                  r["theme"], r["wrong_count"]]))
    return "\n".join(lines)


def themes_json():
    return THEMES


def _json_dumps(obj):
    return json.dumps(obj, ensure_ascii=False)


def _csv_escape(vals):
    out = []
    for v in vals:
        v = str(v)
        if any(c in v for c in ",\"\n"):
            v = '"' + v.replace('"', '""') + '"'
        out.append(v)
    return ",".join(out)
