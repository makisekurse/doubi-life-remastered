#!/usr/bin/env node
/**
 * Single-source-of-truth data sync script:
 * Injects data/*.json into index.html inline constants (RAW_EVT_LIB, RAW_GOAL_LIB, EVT_PATH, HE_XIE)
 * so JSON datasets and the APK-bundled index.html never drift out of sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const evtLib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evtLib_expanded.json'), 'utf8')).EvtLib;
const goalLib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/goalLib_expanded.json'), 'utf8')).Goals;
const evtPath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evtPath_expanded.json'), 'utf8'));
const heXie = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/heXie.json'), 'utf8'));

const htmlPath = path.join(ROOT, 'index.html');
const lines = fs.readFileSync(htmlPath, 'utf8').split('\n');

const replacements = new Map([
  ['const RAW_EVT_LIB = ', `const RAW_EVT_LIB = ${JSON.stringify(evtLib)};`],
  ['const RAW_GOAL_LIB = ', `const RAW_GOAL_LIB = ${JSON.stringify(goalLib)};`],
  ['const EVT_PATH = ', `const EVT_PATH = ${JSON.stringify(evtPath)};`],
  ['const HE_XIE = ', `const HE_XIE = ${JSON.stringify(heXie)};`],
]);

let hitCount = 0;
const updated = lines.map(line => {
  for (const [prefix, replacement] of replacements.entries()) {
    if (line.startsWith(prefix)) {
      hitCount++;
      return replacement;
    }
  }
  return line;
});

if (hitCount !== 4) {
  throw new Error(`Expected to replace 4 data constants in index.html, replaced ${hitCount}`);
}

let html = updated.join('\n');
const totalEvts = evtLib.length;
const newEvts = evtLib.filter(e => Number(e.id) >= 2000).length;
const totalGoals = Object.keys(goalLib).length;

// Keep initial static placeholder labels consistent before JS init runs
html = html.replace(/(<span class="tb-pill-sub" id="tb-evt-count">)\d+(<\/span>)/, `$1${totalEvts}$2`);
html = html.replace(/(<span id="goals-count-txt">已获得 0 \/ )\d+(<\/span>)/, `$1${totalGoals}$2`);
html = html.replace(/(<span id="encyc-progress-txt">已收录 0 \/ )\d+( \(0\.0%\)<\/span>)/, `$1${totalEvts}$2`);
html = html.replace(/(<span id="encyc-new-progress-txt"[^>]*>[^<]*?0 \/ )\d+(<\/span>)/, `$1${newEvts}$2`);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`[OK] Synced data/*.json -> index.html (${totalEvts} events [${newEvts} expanded], ${totalGoals} goals, ${Object.keys(evtPath).length} evtPath rules)`);
