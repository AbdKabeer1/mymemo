# MyMemo — Finnish Spelling Gym 🇫🇮🧩

**MyMemo** is a local web app that turns Finnish vocabulary practice into a real game:
spell Finnish words with letter tiles, save the vocabulary you train, and take strict
daily or weekly tests. Built for language learners working by CEFR level (A1 → C2),
with a word bank organised by everyday themes — working life, shopping, daily life,
transport, healthcare, social services, food, home, nature.

![menu](https://img.shields.io/badge/menu-play_%7C_save_%7C_test_%7C_settings-blue)

## Quick start (local demo)

```bash
cd ~/mymemo
python3 -m pip install -r requirements.txt   # first time only (flask)
python3 app.py
# open http://localhost:5057
```

Everything is local: words, progress and sessions live in `data/mymemo.db` (SQLite).

## Deploy publicly (Vercel + Turso)

MyMemo is deploy-ready for **Vercel** (Flask as a serverless function) with **Turso**
as the hosted SQLite database. Every visitor gets an anonymous per-browser profile —
their own bank, XP and review schedule — no sign-up.

```bash
# 1. Create the database (Turso CLI; free tier is fine)
turso db create mymemo
turso db show mymemo --url          # -> libsql://mymemo-....turso.io
turso db tokens create mymemo       # -> paste as TURSO_AUTH_TOKEN

# 2. Deploy the repo
cd ~/mymemo
npx vercel                          # link/create project, accept defaults
npx vercel env add TURSO_DATABASE_URL production   # paste the libsql:// URL
npx vercel env add TURSO_AUTH_TOKEN production     # paste the token
npx vercel env add MYMEMO_SECRET production        # random string, e.g. openssl rand -hex 32
npx vercel --prod
```

`vercel.json` routes everything through `api/index.py` and bundles `static/`,
`templates/`, `app.py`, `database.py`, `seed_data.py` into the function.

**How identity works:** guests get a random browser id (stored in `localStorage`,
sent as `X-Client-Id`). The server scopes `my_words`, `sessions` and `settings` by
that id, so every visitor has a private bank with no sign-up. Localhost always uses
the id `local`, so your local history stays intact.

**Accounts (optional):** create a username + password from the top-bar "Sign in"
button to sync your bank across devices. Creating an account **merges whatever your
guest browser collected** into it; signing in elsewhere loads the account's bank, XP
and review schedule. Usernames are 3–24 chars (`a–z`, `0–9`, `_`, `-`), passwords 8+
chars, hashed with PBKDF2 (no email, no password-reset flow — it's a lightweight
account). Guests are unaffected; export CSV if you don't want an account.

**Free-tier notes:** Vercel Hobby is free for personal projects; the first request
after idle is slower (cold start + Turso round-trips), and each page load makes a
handful of database calls. Turso's free tier is generous for a small app.

## What you get

The sidebar has exactly the four things the app was specced around:

| # | Menu | What it does |
|---|------|--------------|
| 1 | 🧩 **Play puzzle** | Spelling drill: pick CEFR level (A1–C2 or All), theme, length (10/15/20) and direction (EN→FI, FI→EN, Mixed). Sources: Curriculum, My bank, **Due review**, **Weak words**. Letter tiles *and* typing both work. **Every word you spell correctly is added to your bank automatically.** Streaks, XP and point bonuses keep it game-y. |
| 2 | 💾 **My Words** | Vocabulary you've practiced and saved — plus manual adds and CSV import. Word counts, due-review status per word (due / in Nd), practice counters (✓/✗), and your quiz routine (daily / weekly / every N hours). |
| 3 | 📝 **Take a test** | Strict exam on your bank: every letter counts, no tile helpers, no leniency. Word set can be My bank, **Due review**, or **Weak words**. Home shows a banner when your scheduled test is due. |
| 4 | ⚙️ **Settings** | Default difficulty level (CEFR), practice language/direction, decoy tiles, auto-save wrong words, test reminders (daily/weekly/hours/off), dark mode, data export/reset. |

### The leniency rule (the heart of the game)

Finnish letters **ä, ö, å** count as full letters:

- **Beginner (A1/A2) puzzles** — if you spell a word right but flatten the dots
  (`työ` → `tyo`), you **pass**, with a note showing the correct spelling.
- **B1 and above, and all tests** — dots are mandatory. A flattened word is marked
  *"So close"* and fails. You'll remember them by pain. It works.

Being exactly one letter off (anything else) is simply wrong at every level.

### Grading reference (implementation: `static/js/app.js` → `grade()`)

| Typed | Target | Beginner puzzle | B1+/Test |
|-------|--------|-----------------|----------|
| `työ` | `työ` | ✅ correct | ✅ correct |
| `tyo` | `työ` | ✅ pass (close) | ❌ fail (close) |
| `työt` | `työ` | ❌ wrong | ❌ wrong |

### Practice curriculum vs your bank

The game seeds from a **practice curriculum** of 1007 Finnish↔English words
(`seed_data.py`), tagged by CEFR level (A1 212 · A2 171 · B1 295 · B2 249 · C1 60 · C2 20)
and theme: Working Life & Jobs, Shopping & Money, Daily Life, Transportation,
Healthcare, Social Services & Society, Food & Drink, Home & Living, Nature & Weather.
The curriculum is practice material — it is **not** your bank and its size is never
shown inside a game.

**Your bank is your own vocabulary.** It starts empty and grows from:

- every word you spell correctly in a puzzle or test — results screens confirm
  "＋N new words added to your bank";
- words you add manually;
- words you upload/import from CSV (defaults to your bank).

"My Words", the Home stat "Your bank" and the counter for a test all refer to this
personal bank. **Mastered** = review box 3+ (word is holding at an 8-day interval or
longer). If a level/theme slice is thin, the practice round tops up from a neighbouring
level so a 10-question puzzle always fills.

### Spaced repetition

Each word in your bank walks a Leitner ladder. A correct answer moves it one box up:
**1 → 2 → 4 → 8 → 16 → 32 days** until the next review. A miss resets it to box 0 and
makes it due immediately, so it comes back at the start of your next round.

- Home shows "**N words due for review**" with a one-click **Review now** round.
- **Due review** and **Weak words** (wrong_count > 0, not yet mastered) are selectable
  sources in both Play and Test.
- My Words shows each word's review status ("due", "2d", "16d").

### Close feedback

A wrong answer that is one letter off (`taloo` for `talo`, a missing letter, an extra
consonant) is flagged *"One letter off — close!"* with what you typed. It still does not
pass, but you learn *why* it failed instead of just seeing red.

### CSV import (bring words from your quizlet-like app)

In **My Words → Import from CSV**, one word per line:

```
työsopimus, employment contract
kassa, checkout, A2, shopping
```

Columns: `finnish, english[, level[, theme]]` — commas, semicolons or tabs; optional
defaults in the form. Import into the shared library or straight into My Words.
`Export everything (CSV)` gives you a full backup (library + My Words).

## Tech

- **Backend:** Python 3 + Flask, SQLite (stdlib — no DB server).
- **Frontend:** a single-page app in vanilla JS/CSS — "Nordic notebook" design:
  warm paper, cream cards, serif display type, ink/cream buttons, Finnish-flag-blue
  primary actions, gold marker highlights, light + dark themes.
- **Port:** 5057 (`PORT` env var to change). Data: `data/mymemo.db`.

## Tips

- Test mode = typing only, strict — the real exam feeling.
- `autoSaveWrong` in Settings sends every missed word into My Words automatically.
- Chasing XP? Streak bonuses give +2/letter of streak (max +10). Hints cost 5.

Made for working life, shopping, day-to-day activity, transportation, healthcare,
social services, employment — *and so on and so forth*.
