# Status

Last updated: 2026-10-20 08:35

## Done

- **Turso production DB provisioned & seeded**: `words` = 1007, schema created
  (words/my_words/sessions/settings), remote smoke test passed: bootstrap, passing
  words (bank + box/due), settings persistence, scoped export, cleanup. Remote init
  batched into ~2 HTTP calls (schema in one pipeline request).
- **Public deployment ready (Vercel + Turso)**: `vercel.json`, `api/index.py`,
  `.vercelignore`; Flask runs as a serverless function, static/template files bundled
  via `includeFiles`. `database.py` has a dependency-free Turso HTTP client (Hrana
  pipeline) with batching; local dev still uses SQLite. Remote mode skips local disk
  writes (read-only FS safe).
- **Multi-tenant anonymity**: every player row scoped by `client_id` from validated
  `X-Client-Id` (fallback `local`). Browser generates a random id in localStorage
  (localhost always `local` so existing history stays). Verified isolation: alice vs
  bob banks/XP/settings independent; exports are header-scoped (UI downloads CSV via
  fetch).
- **SRS + near-miss + personal bank** from previous rounds remain.
- Local verification: compile checks pass; local bank untouched (12 words, 188 XP,
  4 sessions at last check).

## In progress

- Nothing.

## Blocked

- None. Production deployed and verified.

## Deployed

- URL: https://mymemo-omega.vercel.app (project `aboki2/mymemo`)
- Deploy config: `vercel.json` uses `builds` + `routes` (legacy mode) so Flask
  receives the original PATH_INFO; `rewrites` to `/api/index` did not preserve paths.
  `includeFiles: "**"` (single glob string — Vercel rejects arrays here).
- Env vars (Production): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
- Verified on prod: `/` 200, `/api/bootstrap` 200 with 1007 curriculum words, static
  CSS 200, POST session persists bank + SRS box, second client isolated (bank 0),
  test rows cleaned.
- Security follow-up: rotate the Turso token (it was shared in chat) — create a new
  token in the Turso dashboard, update the Vercel env var, redeploy.

## Next

1. Create Turso DB, set the two env vars in Vercel, `npx vercel --prod`.
2. Smoke-test on the deployed URL with two browsers/profiles (separate banks).
3. Optional polish: batch bootstrap queries (currently ~10 Turso calls per load),
   cache curriculum in-memory per function instance.

## Current state

- Runs locally at http://localhost:5057 (left running). Syntax checks pass.
- Verified: local client preserved through migration; alice/bob isolation; export
  scoping; Turso request serialization/parsing.
- Known-broken: none known. Deployed path untested against a real Turso instance
  (needs credentials); expected risk is env/DNS/auth, steps documented.
