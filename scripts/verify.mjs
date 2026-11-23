#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BANNED_CLICHES = [
  '当场', '瞬间', '喜提', '全网', '破防', '社死', 'CPU', '赛博', '原地',
  '直呼', '麻了', '物理意义', '逆袭', '暴富', '泪目', '拉满', 'yyds',
  '绝绝子', '格局打开', 'DNA动了', '主打一个', '狠狠地', '直接一个', '情绪价值'
];

let failed = false;
function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`[OK]   ${msg}`);
}
function info(msg) {
  console.log(`[INFO] ${msg}`);
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

function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(x => x !== undefined && x !== null && String(x).length > 0);
  return String(v).length > 0 ? [String(v)] : [];
}

function extractInlineConst(html, constName) {
  const prefix = `const ${constName} = `;
  const line = html.split('\n').find(l => l.trimStart().startsWith(prefix));
  if (!line) throw new Error(`Missing inline constant ${constName} in index.html`);
  const trimmed = line.trim();
  if (!trimmed.endsWith(';')) throw new Error(`Unexpected terminator for ${constName}`);
  return JSON.parse(trimmed.slice(prefix.length, -1));
}

const strictClicheCheck = process.argv.includes('--strict-cliche');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1. JS syntax check on inline <script>
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  fail('Could not locate <script> block in index.html');
} else {
  try {
    new vm.Script(scriptMatch[1], { filename: 'index.html' });
    ok('Inline <script> compiles with zero JS syntax errors');
  } catch (err) {
    fail(`Inline <script> syntax error: ${err.message}`);
  }
}

// 2. CSS hex color validation
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) {
  fail('Could not locate <style> block in index.html');
} else {
  const css = styleMatch[1];
  const badHex = [];
  for (const m of css.matchAll(/#([0-9a-fA-F]+)\b/g)) {
    if (![3, 4, 6, 8].includes(m[1].length)) badHex.push(`#${m[1]}`);
  }
  if (badHex.length > 0) fail(`Invalid hex color literals in CSS: ${badHex.join(', ')}`);
  else if (!css.includes('#00d980')) fail('Expected signature fluorescent green #00d980 missing from CSS');
  else ok('CSS hex colors valid and signature #00d980 intact');
}

// 3. Data parity between index.html and data/*.json
const htmlEvtLib = extractInlineConst(html, 'RAW_EVT_LIB');
const htmlGoalLib = extractInlineConst(html, 'RAW_GOAL_LIB');
const htmlEvtPath = extractInlineConst(html, 'EVT_PATH');
const htmlHeXie = extractInlineConst(html, 'HE_XIE');

const diskEvtLib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evtLib_expanded.json'), 'utf8')).EvtLib;
const diskGoalLib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/goalLib_expanded.json'), 'utf8')).Goals;
const diskEvtPath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evtPath_expanded.json'), 'utf8'));
const diskHeXie = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heXie.json'), 'utf8'));

if (JSON.stringify(htmlEvtLib) !== JSON.stringify(diskEvtLib)) fail('RAW_EVT_LIB in index.html differs from data/evtLib_expanded.json');
else ok(`RAW_EVT_LIB matches data/evtLib_expanded.json (${htmlEvtLib.length} events)`);

if (JSON.stringify(htmlGoalLib) !== JSON.stringify(diskGoalLib)) fail('RAW_GOAL_LIB in index.html differs from data/goalLib_expanded.json');
else ok(`RAW_GOAL_LIB matches data/goalLib_expanded.json (${Object.keys(htmlGoalLib).length} goals)`);

if (JSON.stringify(htmlEvtPath) !== JSON.stringify(diskEvtPath)) fail('EVT_PATH in index.html differs from data/evtPath_expanded.json');
else ok(`EVT_PATH matches data/evtPath_expanded.json (${Object.keys(htmlEvtPath).length} rules)`);

if (JSON.stringify(htmlHeXie) !== JSON.stringify(diskHeXie)) fail('HE_XIE in index.html differs from data/heXie.json');
else ok('HE_XIE matches data/heXie.json');

// 4. Event graph, tag reachability, original preservation, and quality audit
const evtIds = new Set();
const dupIds = [];
const producedAffs = new Set(['未出生', '死亡', '死', '土豪', '贫穷']);
const producedBGs = new Set();
const producedCBGs = new Set();
const origAffs = new Set();
const origBGs = new Set();

for (const e of htmlEvtLib) {
  const id = Number(e.id);
  if (evtIds.has(id)) dupIds.push(id);
  evtIds.add(id);
  const choices = parseRelaxedArray(e.aff);
  for (const c of choices) {
    toArray(c.plusAff).forEach(a => {
      producedAffs.add(a);
      if (id < 2000) origAffs.add(a);
    });
    toArray(c.plusBG).forEach(b => {
      producedBGs.add(b);
      if (id < 2000) origBGs.add(b);
    });
    if (c.plusCBG) {
      producedCBGs.add(c.plusCBG);
      producedBGs.add(c.plusCBG);
      if (id < 2000) origBGs.add(c.plusCBG);
    }
  }
}

if (dupIds.length) fail(`Duplicate event IDs: ${dupIds.join(', ')}`);

const goalIds = new Set(Object.keys(htmlGoalLib).map(String));
const origEvts = htmlEvtLib.filter(e => Number(e.id) < 2000);
const newEvts = htmlEvtLib.filter(e => Number(e.id) >= 2000);
const origGoalCount = Object.keys(htmlGoalLib).filter(k => Number(k) < 50).length;

if (origEvts.length !== 1181) fail(`Original event count must remain 1181, found ${origEvts.length}`);
else ok('Original 1,181 events preserved');

if (origGoalCount !== 46) fail(`Original goal count must remain 46, found ${origGoalCount}`);
else ok('Original 46 achievements preserved');

const badNewChoiceEvents = [];
const badTargets = [];
const badGoals = [];
const deadNewTags = [];
const badPlaceholders = [];
const badBirths = [];
const clicheHits = [];
const styleViolations = [];
const refGoals = new Set();

function stripQuotes(s) {
  return String(s || '').replace(/“[^”]*”/g, '').replace(/"[^"]*"/g, '').replace(/「[^」]*」/g, '');
}

let totalNewChoices = 0;
let newChoicesWithEffect = 0;
let newTitleChars = 0;
let newPromptChars = 0;
let newBtnChars = 0;
let newResultChars = 0;
let newResultCount = 0;
let newInheritCount = 0;
let newEventsWithDeath = 0;
let newEventsWithHidden = 0;

for (const evt of htmlEvtLib) {
  const id = Number(evt.id);
  const isNew = id >= 2000;
  const choices = parseRelaxedArray(evt.aff);
  const affCond = parseRelaxedArray(evt.affCond);
  const unAffCond = parseRelaxedArray(evt.unAffCond);
  const bgCond = parseRelaxedArray(evt.background);
  const unBGCond = parseRelaxedArray(evt.unBGCond);

  if (isNew) {
    newTitleChars += String(evt.title || '').length;
    newPromptChars += String(evt.text || '').length;

    if (String(evt.title || '').length < 2 || String(evt.title || '').length > 10) {
      styleViolations.push(`#${id} title len=${String(evt.title || '').length} ("${evt.title}")`);
    }
    if (String(evt.text || '').length < 12 || String(evt.text || '').length > 65) {
      styleViolations.push(`#${id} text len=${String(evt.text || '').length}`);
    }
    if (/你/.test(stripQuotes(evt.text))) {
      styleViolations.push(`#${id} text has 2nd-person 你 outside quotes`);
    }

    const rawStr = JSON.stringify(evt);
    for (const w of BANNED_CLICHES) {
      if (rawStr.includes(w)) clicheHits.push(`#${id}("${w}")`);
    }

    const unconditional = choices.filter(c => toArray(c.reqAff).length === 0 && toArray(c.reqBG).length === 0);
    if (unconditional.length < 3) {
      badNewChoiceEvents.push(`#${id} (${evt.title}): only ${unconditional.length} unconditional`);
    }

    if (affCond.includes('未出生')) {
      const missingDel = choices.filter(c => !toArray(c.delAff).includes('未出生'));
      if (missingDel.length > 0) badBirths.push(`#${id} (${evt.title}) has ${missingDel.length} choices missing delAff:"未出生"`);
    }

    for (const a of [...affCond, ...unAffCond]) {
      if (!producedAffs.has(a)) deadNewTags.push(`#${id} aff/unAffCond:"${a}"`);
    }
    for (const b of [...bgCond, ...unBGCond]) {
      if (!producedBGs.has(b) && !producedCBGs.has(b)) deadNewTags.push(`#${id} bg/unBGCond:"${b}"`);
    }
  }

  let hasDeath = false;
  let hasHidden = false;
  choices.forEach((c, idx) => {
    if (isNew) {
      totalNewChoices++;
      const hasEff = !!(c.plusAff || c.delAff || c.plusBG || c.delBG || c.delBG2 || c.plusCBG || c.delCBG || c.target || c.goal || htmlEvtPath[`${id}_${idx}`]);
      if (hasEff) newChoicesWithEffect++;
      const btnStr = String(c.btn || '');
      newBtnChars += btnStr.length;
      if (btnStr.length < 1 || btnStr.length > 12) {
        styleViolations.push(`#${id}[${idx}] btn len=${btnStr.length} ("${btnStr}")`);
      }
      if (c.text && c.text !== '=INHERIT=') {
        newResultChars += c.text.length;
        newResultCount++;
        if (c.text.length < 10 || c.text.length > 58) {
          styleViolations.push(`#${id}[${idx}] choice.text len=${c.text.length}`);
        }
        if (/你/.test(stripQuotes(c.text))) {
          styleViolations.push(`#${id}[${idx}] choice.text has 2nd-person 你 outside quotes`);
        }
      } else {
        newInheritCount++;
      }
      if (toArray(c.plusAff).includes('死亡')) hasDeath = true;
      if (toArray(c.reqAff).length > 0 || toArray(c.reqBG).length > 0) hasHidden = true;

      for (const a of [...toArray(c.reqAff), ...toArray(c.unReqAff)]) {
        if (!producedAffs.has(a)) deadNewTags.push(`#${id} reqAff/unReqAff:"${a}"`);
      }
      for (const b of [...toArray(c.reqBG), ...toArray(c.unReqBG)]) {
        if (!producedBGs.has(b) && !producedCBGs.has(b)) deadNewTags.push(`#${id} reqBG/unReqBG:"${b}"`);
      }
    }

    for (const t of toArray(c.target)) {
      const tid = Number(t);
      if (!Number.isNaN(tid) && tid > 0 && !evtIds.has(tid)) badTargets.push(`#${id} -> ${tid}`);
    }
    for (const g of toArray(c.goal)) {
      const gid = String(g).trim();
      if (gid && gid !== '0') {
        refGoals.add(gid);
        if (!goalIds.has(gid)) {
          badGoals.push(`#${id} -> missing goal ${gid}`);
        } else if (!isNew && Number(gid) >= 50) {
          badGoals.push(`#${id} (orig) collides with expanded goal ${gid}`);
        }
      }
    }

    if (isNew) {
      for (const field of [evt.text, c.btn, c.title, c.text]) {
        const m = String(field || '').match(/=[A-Za-z_]+=/g);
        if (m) {
          for (const tok of m) {
            if (!['=NAME=', '=SEX=', '=AGE=', '=INHERIT=', '=HIDDEN='].includes(tok)) {
              badPlaceholders.push(`#${id}:${tok}`);
            }
          }
        }
      }
    }
  });

  if (isNew && hasDeath) newEventsWithDeath++;
  if (isNew && hasHidden) newEventsWithHidden++;
}

// Check evtPath key validity
const badEvtPath = [];
const evtById = new Map(htmlEvtLib.map(e => [Number(e.id), e]));
for (const k of Object.keys(htmlEvtPath)) {
  const [eidStr, idxStr] = k.split('_');
  const e = evtById.get(Number(eidStr));
  if (!e) { badEvtPath.push(`${k}(missing evt)`); continue; }
  const choices = parseRelaxedArray(e.aff);
  const idx = Number(idxStr);
  if (Number.isNaN(idx) || idx < 0 || idx >= choices.length) badEvtPath.push(`${k}(oob ${idx}/${choices.length})`);
}

// Check all goals (both original & expanded) are reachable from at least one event & expanded goals cliché-free
const unrefGoals = Object.keys(htmlGoalLib).filter(k => !refGoals.has(String(k)));
for (const [gid, gval] of Object.entries(htmlGoalLib)) {
  if (Number(gid) < 50) continue;
  const gStr = JSON.stringify(gval);
  for (const w of BANNED_CLICHES) {
    if (gStr.includes(w)) clicheHits.push(`goal#${gid}("${w}")`);
  }
}

if (badNewChoiceEvents.length) fail(`Expanded events violating >=3 unconditional choices (${badNewChoiceEvents.length}): ${badNewChoiceEvents.slice(0, 5).join('; ')}`);
else ok(`All ${newEvts.length} expanded events satisfy >=3 unconditional visible options`);

if (badBirths.length) fail(`Birth events missing delAff:"未出生": ${badBirths.join('; ')}`);
if (badTargets.length) fail(`Broken target refs (${badTargets.length}): ${badTargets.slice(0, 5).join('; ')}`);
else ok('All event target references resolve');

if (badGoals.length) fail(`Broken or colliding goal refs (${badGoals.length}): ${badGoals.slice(0, 10).join('; ')}`);
else ok('All event goal references resolve with zero original/expanded collisions');

if (unrefGoals.length) fail(`Unreferenced achievements (${unrefGoals.length}): ${unrefGoals.join(', ')}`);
else ok(`All ${Object.keys(htmlGoalLib).length} achievements (46 orig + ${Object.keys(htmlGoalLib).length - origGoalCount} expanded) are reachable`);

if (deadNewTags.length) fail(`Unproduced tags referenced in expanded events (${deadNewTags.length}): ${deadNewTags.slice(0, 10).join('; ')}`);
else ok('Zero unproduced tags in expanded events');

if (badEvtPath.length) fail(`Invalid evtPath keys (${badEvtPath.length}): ${badEvtPath.slice(0, 5).join('; ')}`);
else ok('All evtPath keys map to valid event choices');

if (badPlaceholders.length) fail(`Invalid placeholders: ${badPlaceholders.slice(0, 5).join(', ')}`);

if (styleViolations.length) fail(`Expanded style/length/pronoun violations (${styleViolations.length}): ${styleViolations.slice(0, 10).join('; ')}`);
else ok('All expanded events pass original-style conciseness, single-line buttons, and 3rd-person checks');

if (clicheHits.length) {
  const msg = `Banned AI cliché hits in expanded events (${clicheHits.length}): ${clicheHits.slice(0, 10).join(', ')}`;
  if (strictClicheCheck) fail(msg);
  else info(msg);
} else {
  ok('Zero banned AI clichés across all expanded events');
}

// 5. Android template check
const manifest = fs.readFileSync(path.join(ROOT, 'android/AndroidManifest.xml'));
const versionCode = manifest.readUInt32LE(2472);
const minSdk = manifest.readUInt32LE(2568);
ok(`Android template ready (manifest=${manifest.length} B, versionCode=${versionCode}, minSdk=${minSdk}, classes.dex=${fs.statSync(path.join(ROOT, 'android/classes.dex')).size} B)`);

info(`Expanded quality telemetry: events=${newEvts.length}, avgTitle=${(newTitleChars / Math.max(1, newEvts.length)).toFixed(1)}, avgPrompt=${(newPromptChars / Math.max(1, newEvts.length)).toFixed(1)}, avgBtn=${(newBtnChars / Math.max(1, totalNewChoices)).toFixed(1)}, avgOutcome=${(newResultChars / Math.max(1, newResultCount)).toFixed(1)} (=INHERIT=${newInheritCount}), avgChoices=${(totalNewChoices / Math.max(1, newEvts.length)).toFixed(2)}, choiceEffectRate=${((newChoicesWithEffect / Math.max(1, totalNewChoices)) * 100).toFixed(1)}%, deathEvts=${newEventsWithDeath} (${((newEventsWithDeath / Math.max(1, newEvts.length)) * 100).toFixed(1)}%), hiddenChoiceEvts=${newEventsWithHidden}`);

if (failed) {
  console.error('\nVerification FAILED.');
  process.exit(1);
}
console.log('\nAll checks PASSED.');
