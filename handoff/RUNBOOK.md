# Runbook

## Setup

```bash
cd ~/mymemo
python3 -m pip install -r requirements.txt      # flask (already installed on this machine)
```

## Run

```bash
cd ~/mymemo
python3 app.py                                  # → http://localhost:5057
```

Keep it running in its own terminal tab, or in the background:

```bash
nohup python3 app.py > /tmp/mymemo.log 2>&1 &
```

Stop it: `pkill -f "python3 app.py"`.

Optional env: `PORT=8080 python3 app.py`, `MYMEMO_DB=/path/to/other.db`.

## Test

```bash
# syntax
python3 -m py_compile app.py database.py seed_data.py
node --check static/js/app.js

# API smoke (server running)
curl -s http://localhost:5057/api/bootstrap | head -c 300
curl -s "http://localhost:5057/api/round?source=library&level=A1&theme=all&count=3"
curl -s -X POST http://localhost:5057/api/settings -H 'Content-Type: application/json' \
  -d '{"defaultLevel":"B1"}'

# manual QA path
# 1. Home → Start puzzle → answer one word right (exact), one with flattened ä/ö:
#    A1 level: both pass   |   B1+ level: flattened one fails as "close"
# 2. Save a word from the round → My Words shows it → run a Test from My Words (strict).
# 3. Settings → dark mode, level, reminders persist across reload.

# multi-tenant isolation (local server)
curl -s localhost:5057/api/bootstrap -H 'X-Client-Id: alice'
curl -s localhost:5057/api/bootstrap -H 'X-Client-Id: bob'   # separate bank/xp/settings
# note: on localhost the browser uses client id "local" — keep it untouched in tests
```

Fresh-state reset (wipes progress + My Words, keeps library):
```bash
curl -s -X POST http://localhost:5057/api/reset -H 'Content-Type: application/json' -d '{"scope":"progress"}'
```

## Build

- None. No bundler; serve-and-go.

## Deploy

- Platform: Vercel (Flask serverless function) + Turso (hosted libSQL).
- Command:
  ```bash
  turso db create mymemo
  turso db show mymemo --url
  turso db tokens create mymemo
  npx vercel
  npx vercel env add TURSO_DATABASE_URL production
  npx vercel env add TURSO_AUTH_TOKEN production
  npx vercel --prod
  ```
- URL: `https://<project>.vercel.app` (custom domain optional, attach in Vercel settings).
- Files: `vercel.json`, `api/index.py`, `.vercelignore`. Function bundles `app.py`,
  `database.py`, `seed_data.py`, `templates/`, `static/`.

## Environment

- Required env vars (production): `TURSO_DATABASE_URL` (libsql://…),
  `TURSO_AUTH_TOKEN`, `MYMEMO_SECRET` (random string; signs session cookies).
- Local: none required (`PORT`, `MYMEMO_DB` optional).
- Where secrets live: Vercel project env vars (production scope). Never commit tokens.
- Never commit: `data/` (user's DB), `__pycache__/`, `*.db`, `.vercel/`, `.env*`.

## Troubleshooting

- Known issue: `lsof -i :5057` shows a stale server after edits **not** reflected —
  Flask runs with `debug=False`; restart the process to pick up Python changes
  (static JS/CSS reload with browser refresh).
- Fix: `pkill -f "python3 app.py" && nohup python3 app.py > /tmp/mymemo.log 2>&1 &`
- Port taken by AirPlay (5000/7000)? MyMemo defaults to 5057 to avoid it.
- DB lock/weird state: stop server, delete `data/mymemo.db`, rerun (reseeds the 1007 words).
- CSS/JS changes not visible: static assets are cache-busted via `?v=2` in
  `templates/index.html`; bump that query (and restart) after edits, or hard-refresh
  (Cmd+Shift+R).
- Typing inserted several letters at once (fixed 2026-10-20): caused by stacked
  keyboard listeners; `installKeys()` removes the old handler before adding a new one.
- Vercel: "ENOENT ... /var/task/data" or read-only filesystem → the app tried to use
  local SQLite; set both Turso env vars in the Vercel project (production scope) and
  redeploy.
- Vercel cold start feels slow → expected: first request re-runs schema checks and a
  handful of Turso HTTP calls. Warm requests are fine. Seeding is skipped after the
  first run (curriculum count check).
- Turso errors "AUTH_INVALID"/401 → token regenerated or wrong project; update
  `TURSO_AUTH_TOKEN` in Vercel and redeploy.
- Another user sees your words → a query is missing `client_id`; audit recent
  `database.py` changes against AGENTS invariant #8.
