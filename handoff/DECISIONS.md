# Decisions

Record choices the next agent should not re-litigate without a reason.

## 2026-10-20 — Local web app (Flask) over single-file HTML / Tkinter

- Context: user wants a beautiful, professional UI plus persistent saved vocabulary, run locally first.
- Options considered: Flask web app; single-file HTML/JS (localStorage); Python Tkinter desktop.
- Chosen: Flask + SQLite serving a vanilla-JS SPA.
- Why: best-looking UI in browser, real database, trivially extensible to a deployed/mobile app later; still one command to run.
- Trade-off: requires `pip install flask` once (done, user-level).
- Revisit if: user insists on a no-install artifact (then export to single-file with localStorage).

## 2026-10-20 — Accent leniency is level- and mode-gated

- Context: user spec — beginner flattening of ä/ö/å should still pass; intermediate/senior must fail ("say close").
- Options considered: global leniency flag; per-question strictness; fixed rule per spec.
- Chosen: fixed rule — pass only in *puzzle* mode AND level ∈ {A1,A2} AND EN→FI; tests always strict (exam integrity).
- Trade-off: not user-configurable (intentional: keeps grading predictable); documented in README + AGENTS invariant #1.
- Revisit if: user asks for a "chill mode" toggle at higher levels.

## 2026-10-20 — FI→EN grading accepts only the first listed sense

- Context: English glosses store multiple senses (`clock; watch`); free-form English answers are ungradeable.
- Chosen: `enTarget()` compares the first sense only; UI shows a "first meaning only" chip.
- Trade-off: user can't earn credit for valid alternative meanings (e.g. "watch" for `kello`).
- Revisit if: synonyms pass-list is added (small change: split gloss on `;` into an accepted set).

## 2026-10-20 — Typing via captured key events, not an input field

- Context: tiles + typing must coexist; caret/selection juggling with a real text input breaks tile sync.
- Chosen: `keydown` capture appends/removes chars on logical slots; tiles are visual aids.
- Trade-off: mobile virtual keyboard won't open (tiles still work); paste-to-type unsupported.
- Revisit if: mobile/letter-input tests pass poorly.

## 2026-10-20 — Seed bank curated by hand, dictionary forms

- Context: CEFR tagging must be credible for a language-learning tool.
- Options considered: scraping a public Finnish corpus; hand curation.
- Chosen: hand-curated ~328 words, dictionary forms, `;`-separated glosses.
- Trade-off: slower to scale; import path exists for user-authored decks.
- Revisit if: content goes beyond ~2000 words or precision matters for certification.

## Open questions

- Should C2 keep a "social vocabulary" flavour, or broaden to general academic words?
- Does the user want English→Finnish prompt display in Finnish (Finnish-only practice mode: hide English UI strings)?

## 2026-10-20 — Lightweight accounts (username + password)

- Context: progress was browser-bound; users wanted continuity across devices.
- Options: OAuth/magic links (email infra), full auth framework, minimal username/password.
- Chosen: username + PBKDF2 password (Werkzeug), Flask signed-cookie session keyed by `MYMEMO_SECRET`; data scope switches from `b:<client>` to `u:<id>`; registration merges the guest bank; login loads the account. No email, no reset flow.
- Why: no external services, tiny surface area, works on serverless, preserves anonymous guests.
- Trade-off: no password recovery (manual DB fix), no email verification, accounts are convenience-grade not high-security. PBKDF2 forced because macOS system Python lacks `hashlib.scrypt`.
- Revisit if: users need password reset → add email magic-link provider; or OAuth.

## 2026-10-20 — Published code to GitHub

- Context: user asked to publish to their GitHub.
- Chosen: `gh repo create AbdKabeer1/mymemo --public --push`; secrets excluded via `.gitignore` (`data/`, `.env*`, `.vercel`, `*.db`).
- Commit: `MyMemo: Finnish spelling trainer with SRS, accounts, Turso + Vercel deploy`.

## 2026-10-20 — Public hosting: Vercel + Turso, anonymous per-browser profiles

- Context: user wants other people to use MyMemo; local SQLite + writable disk is impossible on Vercel serverless (read-only FS, ephemeral /tmp).
- Options: static PWA (no server), Flask on Vercel + Turso, Flask + Postgres (Neon), full auth.
- Chosen: Flask on Vercel (serverless, `api/index.py`) + Turso via a dependency-free HTTP client; identity = random `client_id` in localStorage sent as `X-Client-Id`; all player rows scoped by it. No accounts/login.
- Why: keeps the app and UI unchanged, preserves offline local dev, no secrets beyond two env vars, zero extra Python deps, cheap on free tiers.
- Trade-off: anonymous identity is device/browser-bound (clearing storage loses the bank; no cross-device sync). Header spoofing is possible but only affects that id. Each Turso query is an HTTP round-trip, so page loads make several calls.
- Revisit if: users need cross-device progress → add magic-link/OAuth accounts and keep the same `client_id`-scoped queries keyed by user id; or cache curriculum per function instance.

## 2026-10-20 — Spaced repetition (Leitner) over SM-2

- Context: random rounds meant missed words were not prioritized; user approved SRS.
- Options: full SM-2 (ease factors), Anki-style scheduler, Leitner boxes.
- Chosen: Leitner boxes 0–5 with fixed intervals 1/2/4/8/16/32 days; wrong → box 0 + due now; mastered = box ≥ 3.
- Why: understandable to a learner, trivial to persist in SQLite, no ease-factor tuning, easy to debug.
- Trade-off: less adaptive than SM-2 for words that are always easy/hard; acceptable for A1–C2 vocab volume.
- Revisit if: bank grows past ~2000 words or the user wants per-word ease tuning.

## 2026-10-20 — "Near" answers fail but explain

- Context: users deserve error-specific feedback, but leniency should stay limited to beginner accents.
- Chosen: Levenshtein ≤1 (≤2 for 10+ chars) after the accent rule → `near` verdict, close-fail styling, shows what was typed, never counts as correct.
- Trade-off: edit-distance feedback can reveal nearly-correct spellings, slightly reducing difficulty; acceptable in a learning tool.

## 2026-10-20 — The bank means the PLAYER's bank, not the seed list

- Context: user corrected the model — "don't show word banks for games; show only the puzzle the player played; save each word they passed and grow their bank as they progress or upload".
- Chosen: curriculum (`words`) is invisible practice material; `my_words` is the bank. Server auto-adds every correct result on session save (`save_passed_words`), results screen reports "+N new words". Public counters are `savedCount` and `masteredCount` (3+ correct). Tests pull only from the player's bank; CSV import defaults to bank.
- Trade-off: no way to browse/seed the whole 1007-word curriculum in UI (intentional); advanced users can import specific words.
- Revisit if: user wants a "browse curriculum" reference page separate from the game.

## 2026-10-20 — UI direction changed to "Nordic notebook"

- Context: user judged the first UI "ugly" and "AI'ish"; demanded professional, creative, user-friendly.
- Options considered: polish the old sidebar gradient theme; adopt a component framework; warm editorial/Nordic notebook style.
- Chosen: warm paper + cream cards + serif display type + ink/cream buttons + gold marker accents + underline slots/keycap tiles; top navigation.
- Why: distinctive and crafted (serif editorial ≠ typical AI dashboard), still fully offline/system fonts, fits Finnish craft aesthetics.
- Trade-off: serif display needs care at small sizes (kept serif for display/numbers only; UI labels stay sans).
- Revisit if: user wants a darker/more playful direction or a brand font (then self-host a font file).

## 2026-10-20 — Quiz schedule supports custom hours

- Context: user asked for weekly/daily **or hours** test scheduling, visible in My Words.
- Chosen: `testFrequency` = daily | weekly | hours | off + `testIntervalHours` (1–720, int); due check in JS, settings persisted server-side; schedule control appears in My Words and Settings.
- Trade-off: no background notifications (local app); due banner only appears on Home/My Words.

## 2026-10-20 — Word bank target: 1000+ everyday words

- Context: user wants >1000 everyday words; first seed had 328.
- Chosen: extend `seed_data.py` in place, dictionary forms, 9 themes, CEFR tags; verify uniqueness with a script before restart.
- Result: 1007 unique words (script-verified, zero duplicates).
- Trade-off: hand-curated volume means glosses are concise; some C1/C2 items are society/work-flavoured per app audience.
- Revisit if: user reports a wrong translation → fix single tuple, restart (INSERT OR IGNORE reseeds only new words).
