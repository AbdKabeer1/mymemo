/* ============================== MyMemo app.js ==============================
   Single-page app: Home / Play puzzle / My Words / Take a test / Settings */

/* ----------------------------- tiny helpers ----------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const BEGINNER = new Set(["A1", "A2"]);

/* Anonymous per-browser identity: all player data is scoped to this id.
   Localhost is always "local" so existing local data stays visible. */
const CLIENT_ID = (() => {
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return "local";
  try {
    let id = localStorage.getItem("mymemo-client");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID()
        : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem("mymemo-client", id);
    }
    return id;
  } catch { return "local"; }
})();

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

async function exportData() {
  const res = await fetch("/api/export", { headers: { "X-Client-Id": CLIENT_ID } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mymemo_export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const REVEAL = { A1: 2, A2: 1, B1: 1, B2: 0, C1: 0, C2: 0 };
const DECOYS = { A1: 2, A2: 2, B1: 3, B2: 4, C1: 5, C2: 5 };
const levelChipClass = (lv) =>
  ["A1", "A2"].includes(lv) ? "chip chip-accent"
    : ["B1", "B2"].includes(lv) ? "chip chip-ok" : "chip chip-warn";

/* ---------------------------------------------------------------------------
   Grading — ONE place defines the accent rule:
   - exact match -> correct
   - same word but ä/ö/å replaced by plain letters:
       beginner puzzle (A1/A2) -> pass ("close" note) | B1+ or tests -> fail
--------------------------------------------------------------------------- */
const norm = (s) => String(s).trim().toLowerCase().replace(/[.,!?;:]+$/, "").replace(/\s+/g, " ");
const lax = (s) => norm(s).replace(/[åä]/g, "a").replace(/ö/g, "o");

/* edit distance — used only to give "one letter off" feedback, never to pass */
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
                          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function grade(typed, target, strict) {
  const t = norm(typed), g = norm(target);
  if (t === g) return "correct";
  if (t && lax(t) === lax(g)) return strict ? "close-fail" : "close-pass";
  if (t && lev(t, g) <= (g.length >= 10 ? 2 : 1)) return "near";
  return "wrong";
}
const strictForRound = (lv) => !BEGINNER.has(lv);
const defaultDir = () => ({ finnish: "en2fi", english: "fi2en", both: "mixed" }[B.settings.practiceLanguage] || "en2fi");

/* ---------------------------------------------------------------------------
   Global state
--------------------------------------------------------------------------- */
let B = null;           // bootstrap payload {levels, themes, settings, summary, recent}
let game = null;        // active round
let keyHandler = null;  // active key capture
const vocabThemes = () => [...B.themes.map(t => t.id), "custom"];

async function bootstrap() {
  B = await api("/api/bootstrap");
  document.body.dataset.theme = B.settings.darkMode ? "dark" : "";
  updChips();
  const auth = $("#authBtn");
  if (auth) {
    auth.textContent = B.user ? B.user.username : "Sign in";
    auth.title = B.user ? "Account — click to manage" : "Sign in to sync across devices";
  }
}

function updChips() {
  $("#levelChip").textContent = B.settings.defaultLevel;
  $("#xpChip").textContent = `${B.summary.xp} XP`;
}

/* ---------------------------------------------------------------------------
   Router
--------------------------------------------------------------------------- */
const TITLES = { home: "Home", play: "Play puzzle", words: "My Words", test: "Take a test", settings: "Settings", review: "Review due" };

function route() {
  if (keyHandler) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
  const name = (location.hash.replace(/^#\//, "") || "home").split("?")[0];
  if (!TITLES[name]) name = "home";
  $$("#nav .nav-item").forEach(a => a.classList.toggle("active", a.dataset.view === name));
  if ($("#viewTitle")) $("#viewTitle").textContent = TITLES[name];
  const view = $("#view");
  view.innerHTML = "";
  ({ home: viewHome, play: viewPlay, review: viewReview, words: viewWords, test: viewTest, settings: viewSettings }[name])(view);
}
window.addEventListener("hashchange", route);

/* ---------------------------------------------------------------------------
   Shared round setup form (used by Play & Test)
--------------------------------------------------------------------------- */
function setupForm(root, opts) {
  const s = B.settings;
  const startDir = defaultDir();
  root.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h3>${opts.title}</h3>
      <div class="sub">${opts.sub}</div>
      <div class="grid grid-2">
        <div class="field">
          <label>Type of round (direction)</label>
          <div class="seg" data-seg="direction">
            <button data-v="en2fi">EN → FI</button>
            <button data-v="fi2en">FI → EN</button>
            <button data-v="mixed">Mixed</button>
          </div>
        </div>
        <div class="field">
          <label>Length</label>
          <div class="seg" data-seg="count">
            <button data-v="10">10</button>
            <button data-v="15">15</button>
            <button data-v="20">20</button>
          </div>
        </div>
        <div class="field">
          <label>CEFR level</label>
          <div class="seg" data-seg="level">
            <button data-v="mixed">All</button>
            ${LEVELS.map(l => `<button data-v="${l}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label>Words</label>
          <div class="seg" data-seg="theme">
            <button data-v="all">All themes</button>
            ${B.themes.map(t => `<button data-v="${t.id}">${t.emoji} ${esc(t.label)}</button>`).join("")}
          </div>
        </div>
      </div>
      <div style="margin-top:18px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
        <label class="field" style="max-width:${opts.testMode ? 350 : 440}px">
          <label>${opts.testMode ? "Word set" : "Practice from"}</label>
          <div class="seg" data-seg="source">
            ${opts.testMode ? "" : `<button data-v="library">Curriculum</button>`}
            <button data-v="mywords">My bank</button>
            <button data-v="review">Due review</button>
            <button data-v="weak">Weak words</button>
          </div>
        </label>
        <div style="margin-left:auto">
          <button class="btn primary big" id="startRound">${opts.cta}</button>
        </div>
      </div>
      <div style="margin-top:16px; font-size:12.5px; color:var(--muted)">
        ${opts.testMode
          ? "Questions come from your own bank — words you passed and words you uploaded."
          : "Every word you spell correctly is saved to your bank automatically."}
      </div>
    </div>`);

  const cfg = { direction: startDir, count: 10, level: s.defaultLevel, theme: "all",
                source: opts.testMode ? "mywords" : "library" };
  $$(".seg", root).forEach(seg => {
    const key = seg.dataset.seg;
    if (!cfg[key]) return;
    paint();
    function paint() {
      $$("button", seg).forEach(b => b.classList.toggle("on", b.dataset.v === String(cfg[key])));
    }
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !(b.dataset.v)) return;
      cfg[key] = b.dataset.v;
      paint();
    });
  });
  $$('.seg[data-seg="count"] button, .seg[data-seg="level"] button', root).forEach(b =>
    b.classList.toggle("on", b.dataset.v === String(cfg[b.closest(".seg").dataset.seg])));
  return cfg;
}

/* ---------------------------------------------------------------------------
   View: Home
--------------------------------------------------------------------------- */
function isTestDue() {
  const f = B.settings.testFrequency;
  if (f === "off") return null;
  const dur = f === "daily" ? 86400e3
    : f === "weekly" ? 604800e3
    : Math.max(1, Number(B.settings.testIntervalHours) || 12) * 3600e3;
  const last = B.summary.lastTestAt ? new Date(B.summary.lastTestAt + "Z").getTime() : 0;
  return (Date.now() - last) > dur ? f : null;
}
function dueLabel() {
  const f = B.settings.testFrequency;
  return f === "hours" ? `${B.settings.testIntervalHours || 12}‑hour` : f;
}

const SCHED_OPTS = [["daily", "Daily"], ["weekly", "Weekly"], ["hours", "Every…"], ["off", "Off"]];
function schedMarkup() {
  return `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
    <div class="seg sched-seg">
      ${SCHED_OPTS.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join("")}
    </div>
    <span class="sched-hours-wrap" style="display:none; align-items:center; gap:7px">
      <input type="number" class="hours-input sched-hours" min="1" max="720"
             value="${B.settings.testIntervalHours || 12}">
      <span class="chip">hours</span>
    </span>
    <span class="chip sched-state"></span>
  </div>`;
}
function dueText() {
  if (B.settings.testFrequency === "off") return "reminders off";
  return isTestDue() ? "test due now" : "scheduled";
}
function wireSched(scope) {
  const seg = $(".sched-seg", scope), hrs = $(".sched-hours", scope);
  const wrap = $(".sched-hours-wrap", scope), state = $(".sched-state", scope);
  if (!seg) return;
  const paint = () => {
    const f = B.settings.testFrequency;
    $$("button", seg).forEach(b => b.classList.toggle("on", b.dataset.v === f));
    wrap.style.display = f === "hours" ? "inline-flex" : "none";
    state.textContent = dueText();
  };
  seg.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    B.settings = (await api("/api/settings", { method: "POST", body: { testFrequency: b.dataset.v } })).settings;
    paint();
  });
  hrs.addEventListener("change", async () => {
    B.settings = (await api("/api/settings", { method: "POST", body: { testIntervalHours: +hrs.value } })).settings;
    paint();
  });
  paint();
}

function viewHome(view) {
  const due = isTestDue();
  const s = B.summary;
  view.innerHTML = `
    <div class="hero">
      <div>
        <div class="eyebrow">Suomen kieli · sanasto</div>
        <h2>Learn Finnish <span class="mark">one word at a time</span>.</h2>
        <p>Spell it, save it, get tested on it. A handwriting-flavoured word game
           that grows your bank with every word you get right.</p>
      </div>
      <div class="hero-cta">
        <a class="btn primary big" href="#/play">Start a puzzle →</a>
        <a class="btn" href="#/test">Take a test</a>
      </div>
    </div>

    ${s.dueCount ? `<div class="card" style="display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap;margin-top:18px">
        <div><b>${s.dueCount} word${s.dueCount === 1 ? "" : "s"} due for review.</b>
          <span class="sub" style="margin:0">Spaced repetition keeps them from slipping away.</span></div>
        <a class="btn primary" href="#/review">Review now →</a>
      </div>` : ""}

    ${due ? `<div class="card" style="display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap;margin-top:18px">
        <div><b>Your ${esc(dueLabel())} test is due.</b> <span class="sub" style="margin:0">A strict round keeps memory fresh.</span></div>
        <a class="btn primary" href="#/test">Take it now</a>
      </div>` : ""}

    <div class="stat-strip">
      <div class="stat"><div class="num">${s.xp}</div><div class="lab">Total XP</div></div>
      <div class="stat"><div class="num">${s.savedCount}</div><div class="lab">Your bank</div></div>
      <div class="stat"><div class="num">${s.dueCount || 0}</div><div class="lab">Due now</div></div>
      <div class="stat"><div class="num">${s.masteredCount || 0}</div><div class="lab">Mastered</div></div>
    </div>

    <div class="menu-grid">
      <button class="menu-card" onclick="location.hash='#/play'">
        <h4>Play puzzle</h4>
        <p>Spelling drill with letter tiles, hints and streaks.</p>
      </button>
      <button class="menu-card" onclick="location.hash='#/words'">
        <h4>Save vocabularies</h4>
        <p>Keep the words you practice and import new ones from CSV.</p>
      </button>
      <button class="menu-card" onclick="location.hash='#/test'">
        <h4>Take a test</h4>
        <p>Strict exam drawn from words you passed or uploaded. Daily, weekly or every N hours.</p>
      </button>
      <button class="menu-card" onclick="location.hash='#/settings'">
        <h4>Settings</h4>
        <p>Difficulty level, language direction, reminders, dark mode.</p>
      </button>
    </div>

    <div class="card" style="margin-top:18px">
      <h3>Recent rounds</h3>
      <div class="sub">Last ${Math.min(6, B.recent.length)} sessions</div>
      ${!B.recent.length ? `<div class="empty"><span class="big">🌱</span>No rounds yet — play your first puzzle!</div>` :
      `<table class="list"><tr><th>Round</th><th>Level</th><th>Score</th><th>XP</th><th>When</th></tr>
        ${B.recent.map(r => `<tr>
          <td>${r.mode === "test" ? "📝 Test" : "🧩 Puzzle"}</td>
          <td><span class="${levelChipClass(r.level || "B1")}">${esc(r.level || "mixed")}</span></td>
          <td>${r.correct}/${r.total}</td><td>${r.score}</td>
          <td>${new Date(r.created_at + "Z").toLocaleString()}</td></tr>`).join("")}
      </table>`}
    </div>`;
}

/* ---------------------------------------------------------------------------
   View: Play puzzle
--------------------------------------------------------------------------- */
function viewPlay(view) {
  const cfg = setupForm(view, {
    title: "🧩 New spelling puzzle",
    sub: "Spell the Finnish word. Beginners (A1/A2) get credit even if the dot-values ä/ö are flattened — from B1 the accents count!",
    cta: "▶ Start puzzle",
  });
  $("#startRound", view).addEventListener("click", () => startRound(view, { mode: "puzzle", ...cfg }));
}

/* ---------------------------------------------------------------------------
   View: Take a test
--------------------------------------------------------------------------- */
function viewTest(view) {
  if (!B.summary.savedCount) {
    view.insertAdjacentHTML("beforeend", `<div class="card" style="margin-bottom:18px">
      <h3>Your bank is empty</h3>
      <div class="sub" style="margin:0">Play a puzzle — every word you spell correctly lands in your bank
        automatically. You can also add or import words in My Words.</div>
    </div>`);
  }
  const cfg = setupForm(view, {
    testMode: true,
    title: "📝 New test",
    sub: "Strict exam mode: every letter counts (including ä, ö, å). Questions are drawn only from your own bank.",
    cta: "▶ Start test",
  });
  $("#startRound", view).addEventListener("click", () => startRound(view, { mode: "test", ...cfg }));
}

/* Quick spaced-repetition round straight from Home */
function viewReview(view) {
  startRound(view, { mode: "puzzle", source: "review", level: "mixed",
                     theme: "all", count: 20, direction: defaultDir() });
}

/* ---------------------------------------------------------------------------
   Round runner (shared by puzzle & test)
--------------------------------------------------------------------------- */
async function startRound(view, cfg) {
  const q = new URLSearchParams(cfg).toString();
  const data = await api("/api/round?" + q);
  if (!data.words.length) {
    const msg = cfg.source === "review"
      ? "Nothing due for review right now — your bank is up to date. 🎉"
      : cfg.source === "weak"
        ? "No weak words yet — get a few wrong on purpose (or not). Play a round first."
        : cfg.mode === "test"
          ? "Your bank has no words matching that filter yet — play a puzzle or import words first."
          : "No words match those filters yet — pick another theme or level.";
    view.insertAdjacentHTML("beforeend", `<div class="empty" style="margin-top:18px">
      <span class="big">🤷</span>${msg}</div>`);
    return;
  }
  game = {
    mode: cfg.mode, words: data.words, i: 0, score: 0, streak: 0, correct: 0,
    results: [], wrong: [], savedFlags: {}, cfg,
    strict: cfg.mode === "test",
    tilesAllowed: cfg.mode !== "test" && cfg.direction !== "fi2en" && B.settings.decoys !== false,
  };
  renderQuestion();
}

function currentWord() { return game.words[game.i]; }

/* direction for this question */
function dirFor(i) {
  const d = game.cfg.direction;
  if (d !== "mixed") return d;
  return i % 2 === 0 ? "en2fi" : "fi2en";
}

/* first sense of an English gloss, lowercased, for FI->EN answers */
function enTarget() {
  return currentWord().english.split(/[;(/]/)[0].trim().replace(/[.,!?;:]+$/, "").toLowerCase();
}

function buildSlots(target) {
  const lv = currentWord().level;
  const revealN = game.mode === "test" ? 0 : (REVEAL[lv] ?? 1);
  return [...target].map((ch, idx) => ({
    ch,
    auto: idx < revealN || ch === " " || ch === "-",
    val: (idx < revealN || ch === " " || ch === "-") ? ch : null,
  }));
}

function renderQuestion() {
  const view = $("#view");
  const w = currentWord();
  const dir = dirFor(game.i);
  const theme = B.themes.find(t => t.id === w.theme);
  const promptText = dir === "en2fi" ? w.english : w.finnish;
  const target = (dir === "en2fi" ? w.finnish : enTarget());
  game.slots = buildSlots(target);
  game.tilesBuilt = false;
  view.innerHTML = `
    <div class="card">
      <div class="game-top">
        <div class="dots">${game.words.map((_, k) =>
          k === game.i ? '<span class="dot cur"></span>'
            : `<span class="dot ${game.results[k] ? (game.results[k] === "correct" ? "ok" : game.results[k] === "close-pass" ? "close" : "bad") : ""}"></span>`).join("")}</div>
        <div style="display:flex; gap:8px">
          <span class="chip">🔥 ${game.streak} streak</span>
          <span class="chip chip-accent">${game.score} pts</span>
          <span class="chip">${game.i + 1}/${game.words.length}</span>
        </div>
      </div>

      <div class="prompt-box">
        ${game.mode === "test" ? `<div class="chip chip-warn">TEST MODE — strict: all letters count</div>` : ""}
        <div class="prompt-label">${dir === "en2fi" ? "Spell it in Finnish" : "Give the English meaning"}</div>
        <div class="prompt-word">${esc(promptText)}</div>
        <div class="prompt-meta">
          <span class="${levelChipClass(w.level)}">${esc(w.level)}</span>
          <span class="chip">${theme ? theme.emoji + " " + esc(theme.label) : esc(w.theme || "custom")}</span>
          <span class="chip">${target.length} letters</span>
          ${dir === "fi2en" ? '<span class="chip">first meaning only</span>' : ""}
        </div>
      </div>

      <div class="slots" id="slots"></div>
      <div class="tiles" id="tiles"></div>
      <div class="game-actions" id="actions"></div>
      <div id="feedback"></div>
    </div>`;
  paintSlots();
  if (game.tilesAllowed && dirFor(game.i) === "en2fi") buildTiles();
  paintActions();
  installKeys();
}

function paintSlots() {
  const box = $("#slots");
  const fillables = game.slots.map((s, i) => ({ s, i })).filter(x => !x.s.auto);
  const nextIdx = fillables.find(x => x.s.val === null)?.i;
  box.innerHTML = game.slots.map((s, i) => `
    <div class="slot ${s.val !== null ? "filled" : ""} ${s.auto ? "reveal" : ""}
      ${i === nextIdx ? "next" : ""}">
      ${s.val ?? "<span style='opacity:.25'>·</span>"}
    </div>`).join("");
  const chk = $("#btnCheck");
  if (chk) chk.disabled = !complete();
}
function nextFillable() { let i = 0; for (const s of game.slots) { if (!s.auto) { if (s.val === null) return i; i++; } } return -1; }
function lastFilled() { let last = -1, idx = 0; for (const s of game.slots) { if (!s.auto) { if (s.val !== null) last = idx; idx++; } } return last; }
function addChar(c) {
  const n = nextFillable();
  if (n < 0) return;
  let idx = 0;
  for (const s of game.slots) { if (!s.auto) { if (idx === n) { s.val = c; break; } idx++; } }
  paintSlots(); syncTiles();
}
function delChar() {
  const l = lastFilled();
  if (l < 0) return;
  let idx = 0;
  for (const s of game.slots) { if (!s.auto) { if (idx === l) { s.val = null; break; } idx++; } }
  paintSlots(); syncTiles();
}
function attempt() { let s = ""; for (const sl of game.slots) s += sl.val ?? ""; return s; }
function complete() { return game.slots.every((s) => (s.auto ? true : s.val !== null)); }

function installKeys() {
  if (keyHandler) document.removeEventListener("keydown", keyHandler); // never stack listeners
  keyHandler = (e) => {
    if ($("#feedback .answer-line")) { // result showing → any key advances
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nextQuestion(); }
      return;
    }
    if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "Enter") { e.preventDefault(); checkAnswer(); return; }
    if (e.key === "Backspace") { e.preventDefault(); delChar(); return; }
    if (e.key.length === 1 && /[a-zåäöA-ZÅÄÖ \-']/.test(e.key)) { e.preventDefault(); addChar(e.key.toLowerCase()); }
  };
  document.addEventListener("keydown", keyHandler);
}

/* --------------------------- tiles --------------------------- */
function buildTiles() {
  const letters = game.slots.filter(s => !s.auto).map(s => s.ch);
  const pool = "abdeghiklmnoprstuvyäö";
  const tiles = [...letters];
  const nD = DECOYS[currentWord().level] ?? 3;
  for (let k = 0; k < nD; k++) tiles.push(pool[Math.floor(Math.random() * pool.length)]);
  tiles.sort(() => Math.random() - 0.5);
  $("#tiles").innerHTML = tiles.map((ch, i) => `<button class="tile" data-c="${esc(ch)}" data-i="${i}">${esc(ch)}</button>`).join("");
  $$("#tiles .tile").forEach(t => t.addEventListener("click", () => addChar(t.dataset.c)));
  syncTiles();
}
function syncTiles() {
  const tiles = $$("#tiles .tile");
  if (!tiles.length) return;
  // mark used greedily: tile letter consumed once per matching filled slot
  const counts = {};
  for (const s of game.slots) if (!s.auto && s.val) counts[s.val] = (counts[s.val] || 0) + 1;
  for (const t of tiles) {
    const c = t.dataset.c;
    if (counts[c] > 0) { counts[c]--; t.classList.add("used"); } else t.classList.remove("used");
  }
}

/* --------------------------- actions & check --------------------------- */
function paintActions() {
  const done = complete();
  $("#actions").innerHTML = `
    <button class="btn" id="btnHint" ${!game.tilesAllowed ? "disabled" : ""}>💡 Hint (−5)</button>
    <button class="btn" id="btnDel">⌫ Delete</button>
    <button class="btn primary" id="btnCheck" ${done ? "" : "disabled"}>✓ Check</button>`;
  $("#btnCheck").addEventListener("click", checkAnswer);
  $("#btnDel").addEventListener("click", delChar);
  if (game.tilesAllowed) $("#btnHint").addEventListener("click", useHint);
}

function useHint() {
  const target = game.slots;
  for (let idx = 0; idx < target.length; idx++) {
    const s = target[idx];
    if (!s.auto && s.val !== s.ch) { s.val = s.ch; s.auto = true; break; } // lock in the right letter
  }
  game.score = Math.max(0, game.score - 5);
  $("#slots") && paintSlots();
  if ($("#tiles") && $("#tiles").children.length) buildTiles();
  paintActions();
  $("#feedback").innerHTML = `<div class="feedback close">💡 Hint used — 5 points off.</div>`;
}

function accentHTML(word) {
  return [...word].map(c => "åäöÅÄÖ".includes(c) ? `<span class="accent-hl">${esc(c)}</span>` : esc(c)).join("");
}

function checkAnswer() {
  if (!complete()) { flash("Fill in every letter first."); return; }
  const w = currentWord();
  const dir = dirFor(game.i);
  const target = dir === "en2fi" ? w.finnish : enTarget();
  const typed = attempt();
  const verdict = grade(typed, target, game.strict);
  const lv = w.level;
  const beginnerLenient = !game.strict && BEGINNER.has(lv) && dir === "en2fi";

  let cls, title, pts = 0;
  if (verdict === "correct") {
    pts = 10; game.streak += 1; pts += 2 * Math.min(Math.max(game.streak - 1, 0), 5);
    cls = "good"; title = "✅ Correct!";
  } else if (verdict === "close-pass") {
    pts = 6; game.streak += 1;
    cls = "good";
    const closePassTitle = `✅ Correct — beginner bonus for the dots! Proper spelling below.`;
    title = closePassTitle;
  } else if (verdict === "close-fail") {
    game.streak = 0;
    cls = "close"; title = "⚠️ So close — but from B1 the dots count (ä, ö, å are letters of their own)";
  } else if (verdict === "near") {
    game.streak = 0;
    cls = "close"; title = "⚠️ One letter off — close! Not counted this time.";
  } else {
    game.streak = 0;
    cls = "badf"; title = "❌ Not quite";
  }

  const ok = verdict === "correct" || verdict === "close-pass";
  game.results[game.i] = verdict === "correct" ? "correct" : verdict;
  game.correct += ok ? 1 : 0;
  game.score += pts;
  if (!ok) game.wrong.push({ finnish: w.finnish, english: w.english, level: w.level });
  game.lastWordSaved = false;

  if (B.settings.autoSaveWrong && !ok) {
    // mirror server auto-save via manual add (dedup on server)
    api("/api/mywords", { method: "POST", body: { words: [{ finnish: w.finnish, english: w.english, level: w.level, theme: w.theme }] } });
    game.lastWordSaved = true;
  }

  $$("#slots .slot").forEach((el, idx) => {
    const s = game.slots[idx];
    if (s.auto) return;
    if (s.val === s.ch) el.classList.add("right"); else { el.classList.add("wrong"); el.innerHTML = `<span class="actual">${esc(s.val ?? "")}</span>`; }
    el.classList.remove("filled", "reveal", "next");
  });

  $("#feedback").innerHTML = `
    <div class="feedback ${cls}">
      ${esc(title)}
      <div class="answer-line">${dir === "en2fi" ? accentHTML(w.finnish) : esc(enTarget()) + " <span style='color:var(--muted);font-size:13px'>(" + esc(w.english) + ")</span>"}</div>
      ${["close-pass", "close-fail", "near"].includes(verdict) ? `<div style="font-size:13px; opacity:.85; margin-top:2px">You typed: <b>${esc(typed)}</b></div>` : ""}
      <div style="margin-top:10px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap">
        <button class="btn" id="btnSaveOne" ${game.lastWordSaved ? "disabled" : ""}>
          ${game.lastWordSaved ? "💾 Saved to My Words" : "💾 Save word"}</button>
        <button class="btn primary" id="btnNext">${game.i + 1 < game.words.length ? "Next →" : "Finish 🏁"}</button>
      </div>
    </div>`;
  $("#btnNext").addEventListener("click", nextQuestion);
  $("#btnSaveOne")?.addEventListener("click", async () => {
    await api("/api/mywords", { method: "POST", body: { words: [{ finnish: w.finnish, english: w.english, level: w.level, theme: w.theme }] } });
    game.lastWordSaved = true;
    $("#btnSaveOne").textContent = "💾 Saved!";
    $("#btnSaveOne").disabled = true;
    bootstrap();
  });
  updChips();
}

function flash(msg) {
  $("#feedback").innerHTML = `<div class="feedback close">${esc(msg)}</div>`;
  setTimeout(() => { if (!$("#feedback .answer-line")) $("#feedback").innerHTML = ""; }, 1300);
}

async function nextQuestion() {
  game.i++;
  if (game.i >= game.words.length) return finishRound();
  renderQuestion();
}

async function finishRound() {
  document.removeEventListener("keydown", keyHandler); keyHandler = null;
  const payload = {
    mode: game.mode, level: game.cfg.level, direction: game.cfg.direction,
    score: game.score, correct: game.correct, total: game.words.length,
    wrong: game.wrong,
    results: game.words.map((w, i) => ({
      finnish: w.finnish, english: w.english, level: w.level, theme: w.theme,
      ok: i < game.results.length && (game.results[i] === "correct" || game.results[i] === "close-pass"),
    })),
  };
  const resp = await api("/api/sessions", { method: "POST", body: payload });
  B.summary.sessionCount += 1; B.summary.xp = resp.xp; B.summary.lastTestAt = resp.lastTestAt;
  B.summary.savedCount = resp.savedCount ?? B.summary.savedCount;
  B.summary.dueCount = resp.dueCount ?? B.summary.dueCount;
  updChips();

  const pct = game.words.length ? Math.round(100 * game.correct / game.words.length) : 0;
  const band = pct >= 90 ? "🥇 Outstanding!" : pct >= 70 ? "💪 Strong!" : pct >= 50 ? "🔥 Getting there!" : "🌱 Keep practicing!";
  const view = $("#view");
  view.innerHTML = `
    <div class="card result-hero">
      <div class="prompt-label">${game.mode === "test" ? "TEST RESULT" : "PUZZLE ROUND COMPLETE"}</div>
      <div class="result-score">${game.score}<span style="font-size:22px; color:var(--muted)"> pts</span></div>
      <div class="result-band">${game.correct}/${game.words.length} correct — ${pct}%</div>
      <div class="band-note">${resp.bankAdded
        ? `＋${resp.bankAdded} new word${resp.bankAdded === 1 ? "" : "s"} added to your bank`
        : "No new words this round — save the misses below."}</div>
      <div>${band}</div>
      <div style="margin-top:18px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap">
        <button class="btn primary" onclick="location.hash='#/play'">🧩 Play again</button>
        <button class="btn" onclick="location.hash='#/test'">📝 Take the test</button>
        <button class="btn" onclick="location.hash='#/words'">💾 My bank</button>
        <button class="btn" onclick="location.hash='#/home'">🏠 Home</button>
      </div>
    </div>
    ${game.wrong.length ? `
      <div class="card wrong-list">
        <h3>Words that slipped (${game.wrong.length})</h3>
        <div class="sub">Review and save them to My Words to drill next time.</div>
        <table class="list">
          ${game.wrong.map(x => `<tr><td class="word-fi">${esc(x.finnish)}</td><td>${esc(x.english)}</td>
            <td><span class="${levelChipClass(x.level)}">${esc(x.level)}</span></td></tr>`).join("")}
        </table>
        <div style="margin-top:14px"><button class="btn primary" id="saveAll">💾 Save all to My Words</button></div>
      </div>` : ""}`;
  $("#saveAll")?.addEventListener("click", async () => {
    await api("/api/mywords", { method: "POST", body: { words: game.wrong } });
    bootstrap();
    $("#saveAll").textContent = "💾 Saved!";
    $("#saveAll").disabled = true;
  });
  game = null;
}

/* ---------------------------------------------------------------------------
   View: My Words
--------------------------------------------------------------------------- */
let wordsFilter = "";
async function viewWords(view) {
  const s = B.summary;
  view.innerHTML = `
    <div class="stat-strip" style="margin-bottom:18px">
      <div class="stat"><div class="num">${s.savedCount}</div><div class="lab">My words</div></div>
      <div class="stat"><div class="num">${s.dueCount || 0}</div><div class="lab">Due now</div></div>
      <div class="stat"><div class="num">${s.masteredCount || 0}</div><div class="lab">Mastered</div></div>
      <div class="stat"><div class="num">${s.xp}</div><div class="lab">Total XP</div></div>
    </div>

    <div class="card" id="schedCard">
      <h3>Quiz routine</h3>
      <div class="sub">When should MyMemo nudge you to test your saved vocabulary?
        Pick daily, weekly, or a custom number of hours. Reminders show on Home.</div>
      ${schedMarkup()}
    </div>

    <div class="toolbar" style="margin-top:18px">
      <input type="text" id="wSearch" placeholder="Search My Words…" value="${esc(wordsFilter)}">
      <button class="btn primary" id="addWordBtn">＋ Add word</button>
      <div style="margin-left:auto; display:flex; gap:8px">
        <button class="btn" id="exportBtn">⬇ Export CSV</button>
      </div>
    </div>
    <div class="card">
      <h3>Saved vocabulary</h3>
      <div class="sub">These words power your tests. Counters update as you practice them.</div>
      <div id="myWordsList"><div class="empty">Loading…</div></div>
    </div>
    <div class="card">
      <h3>Import from CSV</h3>
      <div class="sub">One word per line: <b>finnish, english</b> — optionally add <b>, level, theme</b>.
        Often the app where you already study lets you export columns as CSV; paste them here.
        Semicolons and tabs also work.</div>
      <textarea id="csvBox" placeholder="työpaikka, workplace&#10;kassa, checkout, A2, shopping&#10;talouskasvu, economic growth, C2"></textarea>
      <div class="toolbar" style="margin-top:12px">
        <span class="chip" id="csvCount">0 lines parsed</span>
        <select id="csvLevel" style="max-width:140px">${LEVELS.map(l => `<option ${l === "B1" ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="csvTheme" style="max-width:220px">
          <option value="custom" selected>Theme: custom</option>
          ${B.themes.map(t => `<option value="${t.id}">${t.emoji} ${esc(t.label)}</option>`).join("")}
        </select>
        <select id="csvTarget" style="max-width:240px">
          <option value="mywords" selected>Import to: my bank</option>
          <option value="library">Import to: practice curriculum</option>
        </select>
        <div style="margin-left:auto"><button class="btn primary" id="csvImport">Import</button></div>
      </div>
      <div id="csvMsg" class="sub" style="margin-top:8px"></div>
    </div>`;

  wireSched($("#schedCard"));
  $("#exportBtn").addEventListener("click", exportData);
  $("#wSearch").addEventListener("input", debounce(() => { wordsFilter = $("#wSearch").value; loadMyWords(); }, 280));
  $("#addWordBtn").addEventListener("click", () => addWordModal());
  const box = $("#csvBox");
  const parseCsv = () => parseRows(box.value);
  const upd = () => $("#csvCount").textContent = `${parseCsv().rows.length} lines parsed`;
  box.addEventListener("input", upd); upd();
  $("#csvImport").addEventListener("click", async () => {
    const { rows, skipped } = parseCsv();
    if (!rows.length) { $("#csvMsg").textContent = "Nothing importable found."; return; }
    const target = $("#csvTarget").value;
    const res = await api("/api/import", { method: "POST", body: {
      rows, target, defaultLevel: $("#csvLevel").value, defaultTheme: $("#csvTheme").value } });
    $("#csvMsg").innerHTML = `✅ Imported <b>${res.added}</b>, skipped ${res.skipped} (duplicates/invalid).`;
    box.value = ""; upd(); bootstrap(); loadMyWords();
  });
  await loadMyWords();
}

function parseRows(text) {
  const rows = []; let skipped = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const delim = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const parts = line.split(delim).map(p => p.trim());
    if (parts.length < 2) { skipped++; continue; }
    rows.push(parts.slice(0, 4).map(p => p.replace(/^["']|["']$/g, "")));
  }
  return { rows, skipped };
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function dueBadge(w) {
  if (!w.due_at) return `<span class="chip chip-warn">due</span>`;
  const diff = new Date(w.due_at + "Z").getTime() - Date.now();
  if (diff <= 0) return `<span class="chip chip-warn">due</span>`;
  return `<span class="chip">${Math.ceil(diff / 86400e3)}d</span>`;
}

async function loadMyWords() {
  const data = await api("/api/mywords?q=" + encodeURIComponent(wordsFilter));
  const el = $("#myWordsList");
  if (!data.words.length) {
    el.innerHTML = `<div class="empty"><span class="big">📭</span>Your bank is empty — play a puzzle: every word you spell
      correctly lands here automatically. Or add a word / import a CSV above.</div>`;
    return;
  }
  el.innerHTML = `<table class="list">
    <tr><th>Finnish</th><th>English</th><th></th><th>Practice</th><th>Review</th><th></th></tr>
    ${data.words.map(w => `<tr>
      <td class="word-fi">${esc(w.finnish)}</td>
      <td style="color:var(--muted)">${esc(w.english)}</td>
      <td><span class="${levelChipClass(w.level)}">${esc(w.level)}</span></td>
      <td><span class="chip chip-ok">✓ ${w.correct_count}</span> <span class="chip chip-bad">✗ ${w.wrong_count}</span></td>
      <td>${dueBadge(w)}</td>
      <td><button class="btn danger-btn" data-del="${w.id}" style="padding:6px 12px">🗑</button></td>
    </tr>`).join("")}
  </table>`;
  $$("#myWordsList [data-del]").forEach(b => b.addEventListener("click", async () => {
    await api(`/api/mywords/${b.dataset.del}`, { method: "DELETE" });
    loadMyWords(); bootstrap();
  }));
}

function addWordModal() {
  const themes = vocabThemes();
  const modal = document.createElement("div");
  modal.className = "modal-back";
  modal.innerHTML = `
    <div class="modal">
      <h3>💾 Add a word</h3>
      <div class="grid grid-2">
        <div class="field"><label>Finnish</label><input type="text" id="nwFi" placeholder="esim. työsopimus"></div>
        <div class="field"><label>English</label><input type="text" id="nwEn" placeholder="employment contract"></div>
        <div class="field"><label>Level</label>
          <select id="nwLv">${LEVELS.map(l => `<option ${l === "B1" ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label>Theme</label>
          <select id="nwTh">${themes.map(t => `<option value="${t}">${t === "custom" ? "Custom" : esc(t)}</option>`).join("")}</select></div>
      </div>
      <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end">
        <button class="btn" id="nwCancel">Cancel</button>
        <button class="btn primary" id="nwSave">Save word</button>
      </div>
    </div>`;
  $("#modalRoot").appendChild(modal);
  $("#nwCancel", modal).addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  $("#nwSave", modal).addEventListener("click", async () => {
    const finnish = $("#nwFi", modal).value.trim();
    const english = $("#nwEn", modal).value.trim();
    if (!finnish || !english) return;
    await api("/api/mywords", { method: "POST", body: { words: [{ finnish, english, level: $("#nwLv", modal).value, theme: $("#nwTh", modal).value }] } });
    modal.remove(); bootstrap(); loadMyWords();
  });
  $("#nwFi", modal).focus();
}

/* ---------------------------------------------------------------------------
   View: Settings
--------------------------------------------------------------------------- */
async function viewSettings(view) {
  const s = B.settings;
  view.innerHTML = `
    <div class="card">
      <h3>⚙️ Preferences</h3>
      <div class="settings-row">
        <div class="txt"><b>Practice language</b><span>Which way the round goes by default</span></div>
        <select id="sLang">
          <option value="finnish" ${s.practiceLanguage === "finnish" ? "selected" : ""}>Finnish (spell Finnish words)</option>
          <option value="english" ${s.practiceLanguage === "english" ? "selected" : ""}>English (give meanings)</option>
          <option value="both" ${s.practiceLanguage === "both" ? "selected" : ""}>Both (mixed)</option>
        </select>
      </div>
      <div class="settings-row">
        <div class="txt"><b>Difficulty level</b><span>CEFR level preselected for new rounds</span></div>
        <select id="sLevel">${LEVELS.map(l => `<option ${l === s.defaultLevel ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div class="settings-row">
        <div class="txt"><b>Letter tiles & decoys</b><span>Shuffled tiles with extra distractor letters in puzzles</span></div>
        <label class="switch"><input type="checkbox" id="sDecoys" ${s.decoys ? "checked" : ""}><span class="track"></span></label>
      </div>
      <div class="settings-row">
        <div class="txt"><b>Auto-save wrong words</b><span>Missed words go to My Words automatically</span></div>
        <label class="switch"><input type="checkbox" id="sAuto" ${s.autoSaveWrong ? "checked" : ""}><span class="track"></span></label>
      </div>
      <div class="settings-row">
        <div class="txt"><b>Test reminder</b><span>Home shows a banner when a test is due — daily, weekly, or a custom number of hours</span></div>
        <div id="settingsSched">${schedMarkup()}</div>
      </div>
      <div class="settings-row">
        <div class="txt"><b>Dark mode</b><span>Easier on the eyes at night</span></div>
        <label class="switch"><input type="checkbox" id="sDark" ${s.darkMode ? "checked" : ""}><span class="track"></span></label>
      </div>
    </div>
    <div class="card">
      <h3>Data</h3>
      <div class="sub">All data lives locally in <code>data/mymemo.db</code>.</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn" id="exportAll">⬇ Export everything (CSV)</button>
        <button class="btn danger-btn" id="resetProgress">Reset progress</button>
        <button class="btn danger-btn" id="clearWords">Clear My Words</button>
      </div>
    </div>`;

  wireSched($("#settingsSched"));
  $("#exportAll").addEventListener("click", exportData);
  const save = async (patch) => {
    const resp = await api("/api/settings", { method: "POST", body: patch });
    B.settings = resp.settings;
    document.body.dataset.theme = B.settings.darkMode ? "dark" : "";
    updChips();
  };
  $("#sLang").addEventListener("change", e => save({ practiceLanguage: e.target.value }));
  $("#sLevel").addEventListener("change", e => save({ defaultLevel: e.target.value }));
  $("#sDecoys").addEventListener("change", e => save({ decoys: e.target.checked }));
  $("#sAuto").addEventListener("change", e => save({ autoSaveWrong: e.target.checked }));
  $("#sDark").addEventListener("change", e => save({ darkMode: e.target.checked }));

  $("#resetProgress").addEventListener("click", function () {
    if (this.dataset.arm) { api("/api/reset", { method: "POST", body: { scope: "progress" } }).then(bootstrap); this.textContent = "Reset progress"; delete this.dataset.arm; }
    else { this.dataset.arm = "1"; this.textContent = "Click again to confirm"; setTimeout(() => { this.dataset.arm = ""; this.textContent = "Reset progress"; }, 2500); }
  });
  $("#clearWords").addEventListener("click", function () {
    if (this.dataset.arm) { api("/api/reset", { method: "POST", body: { scope: "mywords" } }).then(() => loadMyWords()).then(bootstrap); this.textContent = "Clear My Words"; delete this.dataset.arm; }
    else { this.dataset.arm = "1"; this.textContent = "Click again to confirm"; setTimeout(() => { this.dataset.arm = ""; this.textContent = "Clear My Words"; }, 2500); }
  });
}

/* ----------------------------- accounts ----------------------------- */
function authModal() {
  const logged = B.user;
  const m = document.createElement("div");
  m.className = "modal-back";
  m.innerHTML = logged ? `
    <div class="modal">
      <h3>Account</h3>
      <div class="sub" style="margin-bottom:14px">Signed in as <b>${esc(logged.username)}</b>.
        Your bank, XP and review schedule sync on every device where you sign in.</div>
      <div style="display:flex; gap:10px; justify-content:flex-end">
        <button class="btn" id="authClose">Close</button>
        <button class="btn danger-btn" id="authOut">Sign out</button>
      </div>
    </div>` : `
    <div class="modal">
      <h3>Save your progress</h3>
      <div class="sub" style="margin-bottom:16px">Create an account and continue on any device.
        Guest words you have collected here are merged into your new account.</div>
      <div class="seg" id="authTabs">
        <button data-mode="login" class="on">Sign in</button>
        <button data-mode="register">Create account</button>
      </div>
      <div style="margin-top:18px; display:flex; flex-direction:column; gap:14px">
        <div class="field"><label>Username</label>
          <input type="text" id="authUser" autocomplete="username" placeholder="3–24 chars: a–z, 0–9, _ or -"></div>
        <div class="field"><label>Password</label>
          <input type="password" id="authPass" autocomplete="current-password" placeholder="At least 8 characters"></div>
        <div id="authErr" style="color:var(--red); font-size:13px; min-height:18px"></div>
      </div>
      <div style="display:flex; gap:10px; justify-content:flex-end">
        <button class="btn" id="authClose">Cancel</button>
        <button class="btn primary" id="authSubmit">Sign in</button>
      </div>
    </div>`;
  $("#modalRoot").appendChild(m);
  const close = () => m.remove();
  $("#authClose", m).addEventListener("click", close);
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  if (logged) {
    $("#authOut", m).addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST", body: {} });
      close();
      await bootstrap();
      route();
    });
    return;
  }
  let mode = "login";
  const setMode = (next) => {
    mode = next;
    $$("#authTabs button", m).forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    $("#authSubmit", m).textContent = mode === "login" ? "Sign in" : "Create account";
    $("#authPass", m).autocomplete = mode === "login" ? "current-password" : "new-password";
    $("#authErr", m).textContent = "";
  };
  $$("#authTabs button", m).forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  const submit = async () => {
    const err = $("#authErr", m);
    err.textContent = "";
    const res = await api(`/api/auth/${mode}`, {
      method: "POST",
      body: { username: $("#authUser", m).value.trim(), password: $("#authPass", m).value },
    });
    if (res.error) { err.textContent = res.error; return; }
    const wasRegistering = mode === "register";
    close();
    await bootstrap();
    route();
    if (wasRegistering) {
      const note = document.createElement("div");
      note.className = "card";
      note.style.cssText = "position:fixed; right:20px; bottom:20px; z-index:60; padding:14px 18px; font-weight:600; font-size:13px";
      note.textContent = "Account created — your bank is now synced.";
      document.body.appendChild(note);
      setTimeout(() => note.remove(), 3200);
    }
  };
  $("#authSubmit", m).addEventListener("click", submit);
  $("#authPass", m).addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  $("#authUser", m).focus();
}

/* ----------------------------- boot ----------------------------- */
$("#authBtn").addEventListener("click", authModal);
(async () => { await bootstrap(); route(); })();
