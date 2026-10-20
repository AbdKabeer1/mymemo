"""MyMemo — Finnish spelling & vocabulary trainer.

Run locally:  python3 app.py   ->  http://localhost:5057
Deploy:       Vercel (api/index.py) + Turso (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)
"""
import os
import re

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import database as db
from seed_data import LEVELS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("MYMEMO_DB", os.path.join(BASE_DIR, "data", "mymemo.db"))
if not db.is_remote():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
db.init(DB_PATH)

app = Flask(__name__)
app.secret_key = (os.environ.get("MYMEMO_SECRET")
                  or os.environ.get("SECRET_KEY") or "mymemo-dev-secret")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("VERCEL")),
)

CLIENT_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
USERNAME_RE = re.compile(r"[a-z0-9_-]{3,24}")


def client_header():
    """Anonymous per-browser id used for guests."""
    raw = request.headers.get("X-Client-Id", "local")
    return raw if CLIENT_RE.fullmatch(raw or "") else "local"


def scope():
    """Data scope: the account when signed in, browser identity otherwise."""
    uid = session.get("uid")
    return f"u:{uid}" if uid else "b:" + client_header()


def conn():
    return db.connect(DB_PATH)


def _word_folder(row):
    return {"finnish": row["finnish"], "english": row["english"],
            "level": row["level"], "theme": row["theme"]}


# ------------------------------------------------------------------- pages

@app.get("/")
def index():
    return render_template("index.html")


# ------------------------------------------------------------------- auth

@app.post("/api/auth/register")
def api_register():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    if not USERNAME_RE.fullmatch(username):
        return jsonify(error="Username needs 3–24 characters: a–z, 0–9, _ or -"), 400
    if not (8 <= len(password) <= 128):
        return jsonify(error="Password needs at least 8 characters"), 400
    guest = "b:" + client_header()
    with conn() as c:
        if db.find_user(c, username):
            return jsonify(error="That username is already taken"), 409
        uid = db.create_user(
            c, username,
            generate_password_hash(password, method="pbkdf2:sha256:600000"))
        db.merge_guest_into_user(c, guest, f"u:{uid}")
    session["uid"] = uid
    return jsonify(ok=True, user={"username": username})


@app.post("/api/auth/login")
def api_login():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    with conn() as c:
        row = db.find_user(c, username)
    if not row or not check_password_hash(row["pass_hash"], password):
        return jsonify(error="Wrong username or password"), 401
    session["uid"] = row["id"]
    return jsonify(ok=True, user={"username": row["username"]})


@app.post("/api/auth/logout")
def api_logout():
    session.pop("uid", None)
    return jsonify(ok=True)


# ------------------------------------------------------------------- api

@app.get("/api/bootstrap")
def api_bootstrap():
    client = scope()
    uid = session.get("uid")
    with conn() as c:
        user = None
        if uid:
            row = db.find_user_by_id(c, uid)
            user = {"username": row["username"]} if row else None
        summary = {
            "libraryCount": db.count_words(c),            "savedCount": db.count_my_words(c, client),
            "masteredCount": db.mastered_count(c, client),
            "dueCount": db.due_count(c, client),
            "sessionCount": db.session_count(c, client),
            "xp": db.total_xp(c, client),
            "lastTestAt": db.last_test_at(c, client),
        }
        return jsonify(
            levels=LEVELS,
            themes=db.themes_json(),
            settings=db.all_settings(c, client),
            summary=summary,
            recent=db.recent_sessions(c, client, 6),
            user=user,
        )


@app.get("/api/words")
def api_words():
    q = request.args.get("q")
    with conn() as c:
        rows = db.query_words(c, request.args.get("level"), request.args.get("theme"),
                              q, request.args.get("limit", 2000))
    return jsonify(words=rows)


@app.get("/api/mywords")
def api_mywords():
    q = request.args.get("q")
    with conn() as c:
        rows = db.query_my_words(c, scope(), q, request.args.get("limit", 2000))
    return jsonify(words=rows)


@app.post("/api/mywords")
def api_add_myword():
    data = request.get_json(force=True) or {}
    items = (data.get("words") or [data])[:500]
    client = scope()
    with conn() as c:
        for it in items:
            finnish = (it.get("finnish") or "").strip()
            english = (it.get("english") or "").strip()
            if not finnish or not english:
                continue
            db.add_my_word(c, client, finnish, english,
                           it.get("level") or "B1", it.get("theme") or "custom")
        return jsonify(count=db.count_my_words(c, client))


@app.delete("/api/mywords/<int:word_id>")
def api_del_myword(word_id):
    with conn() as c:
        db.delete_my_word(c, scope(), word_id)
    return jsonify(ok=True)


@app.post("/api/import")
def api_import():
    data = request.get_json(force=True) or {}
    rows = [r for r in data.get("rows", []) if isinstance(r, list)][:2000]
    target = data.get("target", "library")
    if target not in ("library", "mywords"):
        target = "library"
    with conn() as c:
        result = db.import_rows(c, scope(), rows, target,
                                data.get("defaultLevel", "B1"),
                                data.get("defaultTheme", "custom"))
    return jsonify(result)


@app.get("/api/round")
def api_round():
    """Serve one practice/test round of unique words matching the filters."""
    count = max(1, min(int(request.args.get("count", 10)), 50))
    source = request.args.get("source", "library")
    level = request.args.get("level", "mixed")
    theme = request.args.get("theme", "all")
    client = scope()
    with conn() as c:
        if source == "mywords":
            rows = db.query_my_words(c, client, None, 5000)
            if level and level != "mixed":
                rows = [r for r in rows if r.get("level") == level]
            if theme and theme != "all":
                rows = [r for r in rows if r.get("theme") == theme]
            picked = [dict(_word_folder(r), theme=r.get("theme", "custom")) for r in rows]
        elif source == "review":
            picked = db.due_words(c, client, level, theme, 5000)
        elif source == "weak":
            picked = db.weak_words(c, client, level, theme, 5000)
        else:
            picked = db.query_words(c, level, theme, None, 5000)
        # top up from neighbouring levels only for curriculum rounds
        if source == "library" and level != "mixed" and len(picked) < count:
            idx = LEVELS.index(level)
            if idx > 0:
                more = db.query_words(c, LEVELS[idx - 1], theme, None, 5000)
                have = {r["finnish"] for r in picked}
                picked += [r for r in more if r["finnish"] not in have]
            if len(picked) < count:
                more = db.query_words(c, None, theme, None, 5000)
                have = {r["finnish"] for r in picked}
                picked += [r for r in more if r["finnish"] not in have]
        import random
        random.shuffle(picked)
        bank_count = len(picked)
        picked = picked[:count]
    return jsonify(words=picked, bank_count=bank_count, source=source,
                   level=level, theme=theme)


@app.post("/api/sessions")
def api_sessions():
    data = request.get_json(force=True) or {}
    client = scope()
    with conn() as c:
        db.add_session(c, client, data.get("mode", "puzzle"), data.get("level"),
                       data.get("direction"), int(data.get("score") or 0),
                       int(data.get("correct") or 0), int(data.get("total") or 0),
                       data.get("wrong", []))
        results = data.get("results") or []
        added = db.save_passed_words(c, client, results)
        if results:
            db.apply_results(c, client, results)
        return jsonify(ok=True, xp=db.total_xp(c, client),
                       lastTestAt=db.last_test_at(c, client),
                       bankAdded=added, savedCount=db.count_my_words(c, client),
                       dueCount=db.due_count(c, client))


@app.post("/api/settings")
def api_settings():
    values = request.get_json(force=True) or {}
    client = scope()
    with conn() as c:
        db.save_settings(c, client, values)
        return jsonify(settings=db.all_settings(c, client))


@app.post("/api/reset")
def api_reset():
    data = request.get_json(force=True) or {}
    with conn() as c:
        db.reset(c, scope(), data.get("scope", "progress"))
    return jsonify(ok=True)


@app.get("/api/export")
def api_export():
    with conn() as c:
        csv_text = db.export_csv(c, scope())
    response = app.response_class(csv_text, mimetype="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=mymemo_export.csv"
    return response


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5057))
    print(f"\n  MyMemo running  →  http://localhost:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False)
