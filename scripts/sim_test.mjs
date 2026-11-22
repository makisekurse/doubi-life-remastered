#!/usr/bin/env node
/**
 * Comprehensive headless regression simulator for Doubi Life Remastered.
 * Runs 500 full randomized lives + targeted unit tests on:
 * - 0 JS errors & 0 infinite loops
 * - 100% strict SFX timing invariants (sfx_goal on goal, sfx_aff max 1/turn only on visible new tag)
 * - Cross-life Dragon Ball persistence across death & restart
 * - Compressed DOUBI2 save-code round-trip + legacy raw-JSON restore
 * - HTML escaping (XSS safety) on user names/epitaphs
 * - True anti-spoiler codex search
 * - Guaranteed escape/completion for every closeBG dungeon
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function makeElement(id = '') {
  const classes = new Set();
  const children = [];
  const attrs = new Map();
  let _innerHTML = '';
  const el = {
    id,
    value: '',
    textContent: '',
    src: '',
    style: {},
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 100,
    parentNode: null,
    onclick: null,
    children,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        } else if (force) classes.add(c);
        else classes.delete(c);
      },
      contains: (c) => classes.has(c),
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => classes.add(x)); },
    get innerHTML() { return _innerHTML; },
    set innerHTML(v) { _innerHTML = String(v); if (v === '') children.length = 0; },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    appendChild(child) { child.parentNode = el; children.push(child); return child; },
    insertBefore(child, ref) {
      const existingIdx = children.indexOf(child);
      if (existingIdx !== -1) children.splice(existingIdx, 1);
      child.parentNode = el;
      const refIdx = ref ? children.indexOf(ref) : -1;
      if (refIdx === -1) children.push(child);
      else children.splice(refIdx, 0, child);
      return child;
    },
    remove() {
      if (el.parentNode) {
        const idx = el.parentNode.children.indexOf(el);
        if (idx !== -1) el.parentNode.children.splice(idx, 1);
        el.parentNode = null;
      }
    },
    select() {},
    scrollTo() {},
    querySelectorAll() { return []; },
  };
  return el;
}

const storageMap = new Map();
const elements = new Map();
function getEl(id) {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
}

const listeners = new Map();
const sandbox = {
  console,
  Math,
  Date,
  JSON,
  Set,
  Map,
  Array,
  Object,
  Number,
  String,
  Boolean,
  RegExp,
  Error,
  Promise,
  Uint8Array,
  Blob,
  Response,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  setTimeout: () => 0,
  clearTimeout: () => {},
  navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36' },
  location: { protocol: 'file:' },
  localStorage: {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear(),
  },
  document: {
    hidden: false,
    body: makeElement('body'),
    getElementById: (id) => getEl(id),
    createElement: (tag) => makeElement(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    execCommand: () => true,
  },
  Audio: class MockAudio {
    constructor(src) { this.src = src; this.paused = true; this.ended = false; this.currentTime = 0; this.loop = false; this.volume = 1; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    cloneNode() { return new MockAudio(this.src); }
  },
  URL: { createObjectURL: () => 'blob:mock' },
  addEventListener: (ev, fn) => {
    if (!listeners.has(ev)) listeners.set(ev, []);
    listeners.get(ev).push(fn);
  },
};
sandbox.window = sandbox;
sandbox.__SIM_MODE__ = true;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx = vm.createContext(sandbox);
vm.runInContext(
  script + '\nwindow.__EXPORTS__ = { AudioSys, Helper, Role, GameEngine, UI, RAW_EVT_LIB, GOAL_LIST, EVT_PATH };',
  ctx,
  { filename: 'index.html' }
);

const { AudioSys, Helper, Role, GameEngine, UI, RAW_EVT_LIB, GOAL_LIST } = sandbox.__EXPORTS__;
GameEngine.init();

function assert(cond, msg) {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
}

// ==================== UNIT TESTS ====================

// 1. HTML Escaping test
const escaped = Helper.escHtml('<img src=x onerror="alert(1)">&\'');
assert(!escaped.includes('<') && !escaped.includes('>'), 'Helper.escHtml must neutralize HTML tags');
console.log('[OK]   HTML escaping verified');

// 2. BGM visibilitychange auto-pause / resume test
AudioSys.syncBgm(true);
assert(AudioSys.bgmAudio && !AudioSys.bgmAudio.paused, 'BGM should be playing after syncBgm(true)');
sandbox.document.hidden = true;
(listeners.get('visibilitychange') || []).forEach(fn => fn());
assert(AudioSys.bgmAudio.paused, 'BGM must auto-pause when document.hidden becomes true');
sandbox.document.hidden = false;
(listeners.get('visibilitychange') || []).forEach(fn => fn());
assert(!AudioSys.bgmAudio.paused, 'BGM must auto-resume when returning to foreground');
AudioSys.syncBgm(false);
console.log('[OK]   BGM background auto-pause/resume verified');

// 3. Cross-life Dragon Ball persistence across death & storage reload
GameEngine.attrs = { '金钱': 2000 };
GameEngine.applyAttrRule('一星龙珠', 1);
GameEngine.applyAttrRule('三星龙珠', 1);
GameEngine.saveStorage();
GameEngine.attrs = { '金钱': 0 };
GameEngine.clearActiveRun();
GameEngine.userData.persistentAttrs = {};
GameEngine.loadStorage();
GameEngine.resetAttributes();
assert(GameEngine.attrs['一星龙珠'] === 1 && GameEngine.attrs['三星龙珠'] === 1, 'Dragon Balls must survive death & reload');
console.log('[OK]   Cross-life Dragon Ball persistence verified');

// 4. Compressed DOUBI2 save-code round-trip + legacy raw JSON compatibility
GameEngine.userData.goalIds = [1, 50];
GameEngine.userData.seenEvtIds = [1, 2001];
const rawPayload = GameEngine.buildSavePayload();
const compressed = await Helper.encodeSaveCode(rawPayload);
assert(compressed.startsWith('DOUBI2:'), 'Save code should use DOUBI2 gzip compression');
const decoded = await Helper.decodeSaveCode(compressed);
assert(decoded === rawPayload, 'Decoded DOUBI2 save payload must match original exactly');
assert((await Helper.decodeSaveCode(rawPayload)) === rawPayload, 'Legacy raw JSON save codes must remain compatible');
console.log(`[OK]   Compressed save code round-trip verified (${rawPayload.length} B -> ${compressed.length} B)`);

// 5. Anti-spoiler codex search test
GameEngine.userData.seenEvtIds = [];
GameEngine.config.encycSpoiler = false;
getEl('encyc-search').value = '小区理发店';
UI.renderEncycList();
const fogMatchedCount = getEl('encyc-list').children.length;
assert(fogMatchedCount === 0, `Anti-spoiler codex search leaked unrevealed event title (found ${fogMatchedCount})`);
GameEngine.config.encycSpoiler = true;
UI.renderEncycList();
// Restore clean state before simulation
GameEngine.config.encycSpoiler = false;
storageMap.clear();
GameEngine.userData.goalIds = [];
GameEngine.userData.goalRecords = {};
GameEngine.userData.seenEvtIds = [];
GameEngine.userData.persistentAttrs = {};
console.log('[OK]   Anti-spoiler codex search verified');

// ==================== 500-LIFE RANDOMIZED SIMULATION ====================
let sfxViolations = 0;
let totalTurns = 0;
let maxTurnsInALife = 0;
let origEventsPlayed = 0;
let newEventsPlayed = 0;
const uniqueSeenNew = new Set();
const uniqueGoalsUnlocked = new Set();
const seenDungeons = new Set();
const NUM_LIVES = 500;

for (let run = 0; run < NUM_LIVES; run++) {
  GameEngine.selectedSex = run % 2;
  GameEngine.config.mod_heXie = run >= 400;
  GameEngine.config.sfx = true;
  getEl('input-role-name').value = `测试<${run}>`;
  GameEngine.startNewGame();

  let turns = 0;
  while (GameEngine.role && !GameEngine.role.isDead() && turns < 300) {
    const evt = GameEngine.currentEvt;
    assert(evt && Array.isArray(evt.aff) && evt.aff.length > 0, `Run ${run} turn ${turns}: missing event or choices`);
    if (evt.id >= 2000) {
      newEventsPlayed++;
      uniqueSeenNew.add(evt.id);
    } else {
      origEventsPlayed++;
    }

    const role = GameEngine.role;
    if (role.closeBG) seenDungeons.add(role.closeBG);

    // Filter visible choices exactly as UI.renderCurrentEvent does
    const visible = evt.aff.filter(a => {
      const reqAffs = Helper.toArray(a.reqAff);
      const reqBGs = Helper.toArray(a.reqBG);
      if (reqAffs.length > 0 && !role.isAff(reqAffs)) return false;
      if (reqBGs.length > 0 && !role.isBackground(reqBGs)) return false;
      return true;
    });
    assert(visible.length > 0, `Run ${run} evt #${evt.id}: 0 visible choices!`);

    const pick = visible[Math.floor(Math.random() * visible.length)];

    // Track SFX fired strictly during this turn
    const turnSfx = [];
    sandbox.__ON_SFX__ = (k) => {
      if (k === 'sfx_aff' || k === 'sfx_goal') turnSfx.push(k);
    };
    const roadLenBefore = role.lifeRoad.length;
    GameEngine.chooseAff(pick);
    sandbox.__ON_SFX__ = null;

    const entry = role.lifeRoad[roadLenBefore];
    if (entry) {
      if (entry.goal) {
        uniqueGoalsUnlocked.add(entry.goal);
        if (turnSfx.length !== 1 || turnSfx[0] !== 'sfx_goal') sfxViolations++;
      } else if (entry.addedBanners && entry.addedBanners.length > 0) {
        if (turnSfx.length !== 1 || turnSfx[0] !== 'sfx_aff') sfxViolations++;
      } else {
        if (turnSfx.length !== 0) sfxViolations++;
      }
    }

    turns++;
    totalTurns++;
  }
  assert(turns < 300, `Infinite loop detected on run ${run} (role age=${GameEngine.role?.age}, closeBG=${GameEngine.role?.closeBG})`);
  if (turns > maxTurnsInALife) maxTurnsInALife = turns;
}

assert(sfxViolations === 0, `Strict SFX timing violated ${sfxViolations} times!`);
console.log(`[OK]   500 full lives simulated: 0 JS errors, 0 infinite loops, 0 SFX violations`);
console.log(`[INFO] Total turns=${totalTurns}, avgTurns=${(totalTurns / NUM_LIVES).toFixed(1)}, maxTurns=${maxTurnsInALife}`);
console.log(`[INFO] Event draws: orig=${origEventsPlayed}, expanded=${newEventsPlayed} (${((newEventsPlayed / totalTurns) * 100).toFixed(1)}%)`);
console.log(`[INFO] Unique expanded events seen=${uniqueSeenNew.size}/${RAW_EVT_LIB.filter(e => Number(e.id) >= 2000).length}, unique goals=${uniqueGoalsUnlocked.size}/${GOAL_LIST.length}`);

// ==================== TARGETED CLOSEBG DUNGEON ESCAPE STRESS TEST ====================
const customDungeons = ['康养旅居团', '电诈园区', 'MCN孵化基地', 'AI碳基保护区'];
for (const dName of customDungeons) {
  const hasEvents = RAW_EVT_LIB.some(e => e.background && String(e.background).includes(dName));
  if (!hasEvents) continue;
  for (let i = 0; i < 40; i++) {
    GameEngine.selectedSex = i % 2;
    GameEngine.config.mod_heXie = false;
    getEl('input-role-name').value = `副本测试${i}`;
    GameEngine.startNewGame();
    GameEngine.role.setAge(35);
    GameEngine.role.affected = [];
    GameEngine.role.closeBG = dName;
    GameEngine.presentNextEvent();
    let steps = 0;
    while (GameEngine.role && !GameEngine.role.isDead() && GameEngine.role.closeBG === dName && steps < 40) {
      const evt = GameEngine.currentEvt;
      const visible = evt.aff.filter(a => {
        const ra = Helper.toArray(a.reqAff);
        const rb = Helper.toArray(a.reqBG);
        return (ra.length === 0 || GameEngine.role.isAff(ra)) && (rb.length === 0 || GameEngine.role.isBackground(rb));
      });
      const pick = visible[Math.floor(Math.random() * visible.length)];
      GameEngine.chooseAff(pick);
      steps++;
    }
    assert(steps < 40, `Dungeon "${dName}" softlocked after ${steps} turns!`);
  }
  console.log(`[OK]   Dungeon "${dName}" 40x stress test passed (zero softlocks)`);
}

console.log('\nALL SIMULATION & UNIT TESTS PASSED!');
