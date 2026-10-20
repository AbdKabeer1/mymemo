# Project Handoff

## Goal

Build **MyMemo**, a local web app for a Finnish learner: a game-like spelling and
memorisation trainer with a CEFR-tagged Finnish↔English word bank, personal saved
vocabulary, and scheduled test practice.

## Deliverables

- [x] Flask local web app, runs at http://localhost:5057 (`python3 app.py`)
- [x] Menu: 1) Play puzzle 2) Save vocabularies 3) Take a test 4) Settings
- [x] Word library: 1007 seed words, CEFR levels A1–C2, 9 everyday themes
- [x] Spelling puzzle: tiles + typing, streaks/XP/hints, EN→FI / FI→EN / mixed
- [x] Accent leniency rule: beginner pass on flattened ä/ö/å; B1+ and tests strict
- [x] My Words: save from rounds, manual add, practice counters, delete
- [x] CSV import (library or My Words) + CSV export
- [x] Tests: strict exam mode, My Words or library source, daily/weekly due banner on Home
- [x] Settings: difficulty level, practice language, decoy tiles, auto-save wrong, reminders, dark mode, reset
- [x] README.md, project AGENTS.md, handoff/ folder

## Acceptance criteria

- App starts with one command on macOS system Python 3.9 + Flask; no other setup.
- A1 word flattened (`tyo` for `työ`) passes in an A1/A2 puzzle and fails at B1+ and in tests.
- Saving a word from a round makes it available as a test source (My Words).
- Import adds words without touching seed data (`INSERT OR IGNORE`, no dupes).
- Verified: bootstrap/round/mywords/import/session/settings/export/reset endpoints return 200 with sane JSON (curl pass logged in session).

## Deadline

- Date/time: none stated (personal project demo) — treat as soft.
- Hard or soft deadline: soft.

## Constraints

- Budget: none; local/free stack only.
- Stack: Flask + SQLite + vanilla JS (user chose "local web app" over single-file HTML and Tkinter).
- Accounts/services: none; fully offline.
- Out of scope (v1): mobile app packaging, speaker/audio, conjugation drills, spaced-repetition scheduling beyond simple daily/weekly reminders, multi-user/authorisation.
