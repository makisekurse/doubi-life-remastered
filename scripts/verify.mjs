#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`[OK]   ${msg}`);
}

function parseRelaxedArray(str) {
  if (Array.isArray(str)) return str;
  const trimmed = String(str || '').trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    const fn = new Function('return (' + trimmed + ');');
    return fn();
  }
}

function extractInlineConst(html, constName) {
  const prefix = `const ${constName} = `;
  const line = html.split('\n').find(l => l.trimStart().startsWith(prefix));
  if (!line) throw new Error(`Missing inline constant ${constName} in index.html`);
  const trimmed = line.trim();
  if (!trimmed.endsWith(';')) throw new Error(`Unexpected terminator for ${constName}`);
  return JSON.parse(trimmed.slice(prefix.length, -1));
}

const htmlPath = path.join(ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. Validate CSS Hex colors (guards against accidental global string replacement)
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) {
  fail('Could not locate <style> block in index.html');
} else {
  const css = styleMatch[1];
  const badHex = [];
  for (const m of css.matchAll(/#([0-9a-fA-F]+)\b/g)) {
    const hex = m[1];
    // Ignore CSS ID selectors like #cocos-root (already excluded by hex-only regex)
    // Valid CSS hex color lengths are 3, 4, 6, 8
    if (![3, 4, 6, 8].includes(hex.length)) {
      badHex.push(`#${hex}`);
    }
  }
  if (badHex.length > 0) {
    fail(`Invalid hex color literals in CSS: ${badHex.join(', ')}`);
  } else if (!css.includes('#00d980')) {
    fail('Expected signature fluorescent green #00d980 missing from CSS');
  } else {
    ok('CSS hex colors valid and signature #00d980 intact');
  }
}

// 2. Verify data parity between index.html and data/*.json
const htmlEvtLib = extractInlineConst(html, 'RAW_EVT_LIB');
const htmlGoalLib = extractInlineConst(html, 'RAW_GOAL_LIB');
const htmlEvtPath = extractInlineConst(html, 'EVT_PATH');
const htmlHeXie = extractInlineConst(html, 'HE_XIE');

const diskEvtLib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evtLib_expanded.json'), 'utf8')).EvtLib;
const diskGoalLib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/goalLib_expanded.json'), 'utf8')).Goals;
const diskEvtPath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evtPath_expanded.json'), 'utf8'));
const diskHeXie = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heXie.json'), 'utf8'));

if (JSON.stringify(htmlEvtLib) !== JSON.stringify(diskEvtLib)) {
  fail('RAW_EVT_LIB in index.html differs from data/evtLib_expanded.json');
} else {
  ok(`RAW_EVT_LIB matches data/evtLib_expanded.json (${htmlEvtLib.length} events)`);
}

if (JSON.stringify(htmlGoalLib) !== JSON.stringify(diskGoalLib)) {
  fail('RAW_GOAL_LIB in index.html differs from data/goalLib_expanded.json');
} else {
  ok(`RAW_GOAL_LIB matches data/goalLib_expanded.json (${Object.keys(htmlGoalLib).length} goals)`);
}

if (JSON.stringify(htmlEvtPath) !== JSON.stringify(diskEvtPath)) {
  fail('EVT_PATH in index.html differs from data/evtPath_expanded.json');
} else {
  ok(`EVT_PATH matches data/evtPath_expanded.json (${Object.keys(htmlEvtPath).length} rules)`);
}

if (JSON.stringify(htmlHeXie) !== JSON.stringify(diskHeXie)) {
  fail('HE_XIE in index.html differs from data/heXie.json');
} else {
  ok('HE_XIE matches data/heXie.json');
}

// 3. Validate event invariants, >=3 unconditional visible options for id >= 2000, and target/goal references
const evtIds = new Set(htmlEvtLib.map(e => Number(e.id)));
const goalIds = new Set(Object.keys(htmlGoalLib).map(String));

let origCount = 0;
let newCount = 0;
const badNewChoiceEvents = [];
const badNewTargets = [];
const badNewGoals = [];
const legacyMissingGoals = [];
const parseErrors = [];

for (const evt of htmlEvtLib) {
  const id = Number(evt.id);
  const isNew = id >= 2000;
  if (isNew) newCount++;
  else origCount++;

  let choices;
  try {
    choices = parseRelaxedArray(evt.aff);
  } catch (err) {
    parseErrors.push(`id=${id}: ${err.message}`);
    continue;
  }

  if (isNew) {
    const unconditional = choices.filter(c => {
      const hasReqAff = c.reqAff && (Array.isArray(c.reqAff) ? c.reqAff.length > 0 : String(c.reqAff).trim() !== '');
      const hasReqBG = c.reqBG && (Array.isArray(c.reqBG) ? c.reqBG.length > 0 : String(c.reqBG).trim() !== '');
      return !hasReqAff && !hasReqBG;
    });
    if (unconditional.length < 3) {
      badNewChoiceEvents.push(`id=${id} ("${evt.title}") has only ${unconditional.length} unconditional options`);
    }
  }

  for (const c of choices) {
    if (c.target !== undefined && c.target !== null && String(c.target).trim() !== '') {
      const targets = Array.isArray(c.target) ? c.target : [c.target];
      for (const t of targets) {
        const tid = Number(t);
        if (!Number.isNaN(tid) && tid > 0 && !evtIds.has(tid)) {
          badNewTargets.push(`evt ${id} -> missing target ${tid}`);
        }
      }
    }
    if (c.goal !== undefined && c.goal !== null && String(c.goal).trim() !== '') {
      const goals = Array.isArray(c.goal) ? c.goal : [c.goal];
      for (const g of goals) {
        const gid = String(g).trim();
        if (gid && gid !== '0' && !goalIds.has(gid)) {
          if (isNew) badNewGoals.push(`evt ${id} -> missing goal ${gid}`);
          else legacyMissingGoals.push(`evt ${id} -> goal ${gid}`);
        }
      }
    }
  }
}

if (parseErrors.length) fail(`Event option parse errors: ${parseErrors.slice(0, 5).join('; ')}`);
else ok(`All ${htmlEvtLib.length} events parsed cleanly (original: ${origCount}, expanded: ${newCount})`);

if (badNewChoiceEvents.length) fail(`Expanded events violating >=3 unconditional choices: ${badNewChoiceEvents.slice(0, 5).join('; ')}`);
else ok(`All ${newCount} expanded events satisfy >=3 unconditional visible options`);

if (badNewTargets.length) fail(`Broken target references (${badNewTargets.length}): ${badNewTargets.slice(0, 5).join('; ')}`);
else ok('All event target references resolve');

if (badNewGoals.length) fail(`Broken expanded goal references (${badNewGoals.length}): ${badNewGoals.slice(0, 5).join('; ')}`);
else ok(`All expanded event goal references resolve (legacy original-data unmapped goals: ${legacyMissingGoals.length})`);

// 4. Verify Android container template basics
const manifestPath = path.join(ROOT, 'android/AndroidManifest.xml');
const dexPath = path.join(ROOT, 'android/classes.dex');
if (fs.existsSync(manifestPath) && fs.existsSync(dexPath)) {
  const manifest = fs.readFileSync(manifestPath);
  const versionCode = manifest.readUInt32LE(2472);
  const minSdk = manifest.readUInt32LE(2568);
  ok(`Android template present (manifest=${manifest.length} B, versionCode=${versionCode}, minSdk=${minSdk}, classes.dex=${fs.statSync(dexPath).size} B)`);
} else {
  fail('Missing android/AndroidManifest.xml or android/classes.dex');
}

if (process.exitCode) {
  console.error('\nVerification FAILED.');
  process.exit(process.exitCode);
} else {
  console.log('\nAll checks PASSED.');
}
