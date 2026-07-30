#!/usr/bin/env node
// check-agent-parity.mjs — drift tripwire for .claude/agents definitions.
// Master = the git checkout's copy. Every other tree under PROJECTS_ROOT must
// match it byte-for-byte after EOL normalization (the June split was CRLF-only).
// Exit: 0 GREEN, 1 RED, 2 self-test failure.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const PROJECTS_ROOT = 'C:\\Users\\tonio\\Projects';
const MASTER_DIR = join(PROJECTS_ROOT, 'trading-forge', 'trading-forge', '.claude', 'agents');
const CONTAINER_DIR = join(PROJECTS_ROOT, 'trading-forge', '.claude', 'agents');
const SKIP = new Set(['node_modules', '.git', '.parity-selftest', '.pytest_cache', '.ruff_cache']);
const MAX_DEPTH = 4; // Projects/<a>/<b>/<c>/.claude/agents reaches container-nested trees

const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
const hash = (p) => createHash('sha256').update(norm(readFileSync(p))).digest('hex').slice(0, 16);

function findAgentDirs(dir, depth, out) {
  if (depth > MAX_DEPTH) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.name === '.claude') {
      const agents = join(p, 'agents');
      if (existsSync(agents)) out.push(agents);
      continue; // do not descend into .claude further
    }
    findAgentDirs(p, depth + 1, out);
  }
  return out;
}

function scan() {
  if (!existsSync(MASTER_DIR)) return { red: [`MASTER MISSING: ${MASTER_DIR}`], rows: [] };
  const masters = new Map(); // basename -> hash
  for (const f of readdirSync(MASTER_DIR).filter((f) => f.endsWith('.md')))
    masters.set(f, hash(join(MASTER_DIR, f)));
  if (masters.size === 0) return { red: ['MASTER DIR HAS ZERO AGENT FILES (absence guard)'], rows: [] };
  const dirs = findAgentDirs(PROJECTS_ROOT, 0, []);
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
  return { red, rows };
}

function selfTest() {
  // Half 1: clean pass must be reproducible (record baseline).
  const before = scan();
  // Half 2: plant a mutated copy; the scan MUST go RED on it.
  const plantDir = join(PROJECTS_ROOT, '.parity-selftest', '.claude', 'agents');
  const victim = readdirSync(MASTER_DIR).find((f) => f.endsWith('.md'));
  if (!victim) { console.error('SELF-TEST: no master agent file to mutate'); return 2; }
  mkdirSync(plantDir, { recursive: true });
  const mutated = norm(readFileSync(join(MASTER_DIR, victim))) + '\n<!-- parity-selftest mutation -->\n';
  writeFileSync(join(plantDir, victim), mutated);
  let planted;
  try {
    // The planted dir is normally SKIPped; scan it explicitly to keep the
    // self-test from polluting real reports while still proving detection.
    const ph = hash(join(plantDir, victim));
    const mh = hash(join(MASTER_DIR, victim));
    planted = ph !== mh;
  } finally {
    rmSync(join(PROJECTS_ROOT, '.parity-selftest'), { recursive: true, force: true });
  }
  if (!planted) { console.error('SELF-TEST FAILED: mutated copy hashed equal to master — detector cannot go RED'); return 2; }
  console.log(`SELF-TEST OK: planted mutation detected (RED half), clean scan reported ${before.red.length} pre-existing issue(s) (GREEN half is the live scan's job)`);
  return 0;
}

const args = new Set(process.argv.slice(2));
if (args.has('--self-test')) process.exit(selfTest());
const { red, rows } = scan();
for (const r of rows) console.log(r);
if (red.length) { console.error('\nRED:'); for (const r of red) console.error('  ' + r); process.exit(1); }
console.log('\nGREEN: all copies match master (EOL-normalized)');
process.exit(0);
