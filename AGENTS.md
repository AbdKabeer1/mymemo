# AGENTS.md — MyMemo project

Project-specific agent instructions. The global `~/AGENTS.md` governs working style
(deadline-first, handoff discipline); this file governs **MyMemo's stack and rules**.

## What this is

Finnish spelling & vocabulary trainer as a local Flask web app ("game, not a dormant
app"). One user, local-only, zero external services.

## Run & verify

```bash
cd ~/mymemo
python3 app.py            # http://localhost:5057
node --check static/js/app.js
python3 -m py_compile app.py database.py seed_data.py
```

Verify after any change: `curl -s http://localhost:5057/api/bootstrap` returns JSON
with `summary.libraryCount == 2036` (fresh DB, 2036 unique seed words).

## Stack rules

- Backend: Flask + SQLite only. Don't add servers, ORMs, or dependencies without
  cause; stdlib `sqlite3` is the storage layer and `data/mymemo.db` is the only DB.
- Production: Turso (libSQL over HTTP) when `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
  are set; Vercel serverless function at `api/index.py`. No local disk writes in prod
  (read-only filesystem) — never `os.makedirs`/SQLite path logic when remote.
- Multi-tenant: every player-owned query must filter by `client_id` (from the
  validated `X-Client-Id` header via `cid()`); the `words` curriculum is global.
- Frontend: vanilla JS/CSS, no build step, no CDN assets (must work offline).
- Python must stay 3.9-compatible (system python is `/usr/bin/python3`, 3.9;
  Vercel runtime is newer — no 3.13-only syntax).
- Port 5057 default; `PORT` env overrides. `MYMEMO_DB` env overrides DB path.

## Invariants (do not break)

1. **Grading lives in one place**: `grade()` in `static/js/app.js`.
   - Exact match → correct.
   - Accent-flattened match (ä/ö/å → a/o/a), same length →
     `close-pass` **only** when: puzzle mode AND level ∈ {A1, A2} AND direction EN→FI;
     otherwise `close-fail`.
   - Tests are always strict (`game.strict = mode === 'test'`).
   - After the accent check, a Levenshtein distance ≤1 (≤2 for 10+ char answers)
     returns `near`: close-fail feedback, never passes.
2. Words are stored in dictionary form; `seed_data.py` must contain **unique**
   Finnish words (DB enforces UNIQUE — a duplicate entry silently skips).
3. English glosses use `;` to separate senses and `(...)` for notes;
   FI→EN grading compares only the **first** sense (`enTarget()`).
4. Never seed overwrites: DB init uses `INSERT OR IGNORE`; user data (My Words,
   sessions, settings) must survive restarts and reseeding.
5. Word bank content changes go in `seed_data.py` only, tagged (finnish, english,
   level, theme); themes defined in `seed_data.THEMES`; keep them sensible for
   working life / services / everyday life (the app's stated audience).
6. **Bank semantics:** `words` is the practice curriculum (never surfaced as a count
   inside games). The player's bank is `my_words`; every word answered correctly
   (puzzle or test) is auto-added server-side via `save_passed_words()` from session
   `results` (`ok: true`, incl. beginner close-pass). Never show `libraryCount` in
   game/setup UI — bank counters are personal (`savedCount`, `masteredCount`, `dueCount`).
   Manual/imported words are tagged automatically via `auto_tag()` (exact curriculum
   match, else length + English-keyword heuristics); never ask users for level/theme.
7. **Spaced repetition:** `apply_results()` owns the schedule — correct bumps box
   (0–5, capped) and sets `due_at = now + BOX_DAYS[box]` (1/2/4/8/16/32 days); a miss
   resets box 0 and `due_at = now`. `dueCount` = due_at NULL or ≤ now. Mastered = box ≥ 3.
   Do not compute scheduling client-side; the server is the source of truth.
8. **Multi-tenant safety:** `client_id` comes only from `scope()` — `u:<user id>` when
   signed in (Flask session cookie signed by `MYMEMO_SECRET`), else `b:<validated
   X-Client-Id>` (regex-validated, fallback `b:local`). Every `my_words` / `sessions` /
   `settings` query must include `client_id = ?`. A new endpoint that forgets this
   leaks another user's bank — treat it as a release blocker. Timestamps are UTC
   (`now_iso()`), the client appends `Z` when parsing.
9. **Passwords:** always `generate_password_hash(password, method="pbkdf2:sha256:600000")`
   — the system Python on macOS lacks `hashlib.scrypt`, so Werkzeug's default breaks
   locally. Usernames are lowercased; register merges the guest scope into the new
   account (`merge_guest_into_user`).

## Data model (memory jogger)

- `words` — the library (seed + imports).
- `my_words` — saved personal vocab with practice counters (`correct_count`,
  `wrong_count`; sessions bump these via `results` payloads).
- `sessions` — every puzzle/test round; XP is the sum of `score`.
- `settings` — key/value, defaults in `database.DEFAULT_SETTINGS`.

## Style

- UI: "Nordic notebook" — warm paper (`#f5f1e8`), cream cards, serif display type
  (Iowan Old Style/Palatino/Georgia stack), sans UI text, ink/cream buttons,
  Finnish blue `#1c4e80` for primary actions, gold marker highlights, underline-style
  spelling slots and keycap letter tiles. Light + dark themes via `[data-theme=dark]`
  tokens in `style.css`. Restrained editorial layout — no gradients, no heavy shadows.
- User-facing strings: English, friendly tones; Finnish words everywhere as content.
- No frameworks, no transpilers. Keep `app.js` one file.

## Handoff

`handoff/` is updated before every session ends (README/STATUS/DECISIONS/RUNBOOK).
