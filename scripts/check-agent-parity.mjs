#!/usr/bin/env node
// check-agent-parity.mjs — drift tripwire for .claude/agents definitions.
// Master = the git checkout's copy. Every other tree under PROJECTS_ROOT must
// match it byte-for-byte after EOL normalization (the June split was CRLF-only).
// Exit: 0 GREEN, 1 RED, 2 self-test failure.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROJECTS_ROOT = 'C:\\Users\\tonio\\Projects';
const MASTER_DIR = join(PROJECTS_ROOT, 'trading-forge', 'trading-forge', '.claude', 'agents');
const CONTAINER_DIR = join(PROJECTS_ROOT, 'trading-forge', '.claude', 'agents');
const SKIP = new Set(['node_modules', '.git', '.parity-selftest', '.pytest_cache', '.ruff_cache']);
const MAX_DEPTH = 6; // .claude/worktrees/<wt>/.claude/agents nests six dirs below PROJECTS_ROOT (F-1)

const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
const hash = (p) => createHash('sha256').update(norm(readFileSync(p))).digest('hex').slice(0, 16);

function findAgentDirs(dir, depth, out, allowSelfTest) {
  if (depth > MAX_DEPTH) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP.has(e.name) && !(allowSelfTest && e.name === '.parity-selftest')) continue;
    const p = join(dir, e.name);
    if (e.name === '.claude') {
      const agents = join(p, 'agents');
      if (existsSync(agents)) out.push(agents);
      // F-1 fix: DESCEND into .claude too — registered worktrees under
      // .claude/worktrees/<wt>/ carry their own nested .claude/agents.
      findAgentDirs(p, depth + 1, out, allowSelfTest);
      continue;
    }
    findAgentDirs(p, depth + 1, out, allowSelfTest);
  }
  return out;
}

// F-1 independence fix: a checker that shares its sweeper's enumerator cannot
// see that enumerator's blind spots. This census is a second, structurally
// different path: exhaustive bounded FILE walk, no .claude special-case, its
// own depth bound. RED if it finds a copy the scan's walker did not.
const CENSUS_MAX_DEPTH = 9;
function censusFiles(dir, depth, names, out) {
  if (depth > CENSUS_MAX_DEPTH) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      censusFiles(p, depth + 1, names, out);
    } else if (names.has(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function scan(allowSelfTest = false) {
  if (!existsSync(MASTER_DIR)) return { red: [`MASTER MISSING: ${MASTER_DIR}`], rows: [] };
  const masters = new Map(); // basename -> hash
  for (const f of readdirSync(MASTER_DIR).filter((f) => f.endsWith('.md')))
    masters.set(f, hash(join(MASTER_DIR, f)));
  if (masters.size === 0) return { red: ['MASTER DIR HAS ZERO AGENT FILES (absence guard)'], rows: [] };
  const dirs = findAgentDirs(PROJECTS_ROOT, 0, [], allowSelfTest);
  const red = [];
  const rows = [];
  if (!dirs.includes(CONTAINER_DIR)) red.push(`CONTAINER COPY DIR MISSING: ${CONTAINER_DIR}`);
  for (const [name, mh] of masters) {
    let copies = 0, divergent = 0;
    for (const d of dirs) {
      if (d === MASTER_DIR) continue;
      const p = join(d, name);
      if (!existsSync(p)) continue;
      copies++;
      const h = hash(p);
      if (h !== mh) { divergent++; red.push(`DRIFT ${name}: ${p} = ${h}, master = ${mh}`); }
    }
    rows.push(`${name}: master ${mh}, ${copies} copies, ${divergent} divergent`);
  }
  // F-1 independence: cross-check the walker's population against the census.
  const seen = new Set();
  for (const d of dirs) for (const name of masters.keys()) {
    const p = join(d, name);
    if (existsSync(p)) seen.add(p);
  }
  for (const name of masters.keys()) seen.add(join(MASTER_DIR, name));
  const censused = censusFiles(PROJECTS_ROOT, 0, new Set(masters.keys()), []);
  for (const p of censused) {
    if (!seen.has(p)) red.push(`CENSUS MISS: ${p} exists but the scan walker never reached it`);
  }
  return { red, rows };
}

function selfTest() {
  // Discriminating fixture routed through the REAL pipeline (walker + scan),
  // not a bypass hash — a walker regression must fail this test.
  const plantRoot = join(PROJECTS_ROOT, '.parity-selftest');
  const plantDir = join(plantRoot, '.claude', 'agents');
  const victim = readdirSync(MASTER_DIR).find((f) => f.endsWith('.md'));
  if (!victim) { console.error('SELF-TEST: no master agent file to mutate'); return 2; }
  const baseline = scan(true); // plant absent — self-test dir must not appear
  if (baseline.red.some((r) => r.includes('.parity-selftest'))) {
    console.error('SELF-TEST FAILED: stale .parity-selftest dir present — remove it and rerun');
    return 2;
  }
  mkdirSync(plantDir, { recursive: true });
  writeFileSync(join(plantDir, victim), norm(readFileSync(join(MASTER_DIR, victim))) + '\n<!-- parity-selftest mutation -->\n');
  let planted;
  try {
    planted = scan(true); // walker must DISCOVER the plant and the scan must flag it
  } finally {
    rmSync(plantRoot, { recursive: true, force: true });
  }
  const caught = planted.red.some((r) => r.startsWith(`DRIFT ${victim}`) && r.includes('.parity-selftest'));
  if (!caught) {
    console.error('SELF-TEST FAILED: planted mutation NOT flagged by the walker+scan pipeline (walker or hash regression)');
    return 2;
  }
  const after = scan(true);
  if (after.red.some((r) => r.includes('.parity-selftest'))) {
    console.error('SELF-TEST FAILED: planted row persists after cleanup');
    return 2;
  }
  console.log(`SELF-TEST OK: walker+scan pipeline flagged the planted mutation and cleared after cleanup (baseline red rows: ${baseline.red.length})`);
  return 0;
}

const args = new Set(process.argv.slice(2));
if (args.has('--self-test')) process.exit(selfTest());
const { red, rows } = scan();
for (const r of rows) console.log(r);
if (red.length) { console.error('\nRED:'); for (const r of red) console.error('  ' + r); process.exit(1); }
console.log('\nGREEN: all copies match master (EOL-normalized)');
process.exit(0);
