#!/usr/bin/env node
// sweep-agent-definitions.mjs — copy the master accuracy-validator.md into every
// discovered .claude/agents dir. Default is DRY RUN; pass --apply to write.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROJECTS_ROOT = 'C:\\Users\\tonio\\Projects';
const MASTER = join(PROJECTS_ROOT, 'trading-forge', 'trading-forge', '.claude', 'agents', 'accuracy-validator.md');
const SKIP = new Set(['node_modules', '.git', '.parity-selftest', '.pytest_cache', '.ruff_cache']);
const MAX_DEPTH = 6; // .claude/worktrees/<wt>/.claude/agents nests six dirs below PROJECTS_ROOT (F-1)
const APPLY = process.argv.includes('--apply');

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
      // F-1 fix: DESCEND into .claude too — registered worktrees under
      // .claude/worktrees/<wt>/ carry their own nested .claude/agents.
      findAgentDirs(p, depth + 1, out);
      continue;
    }
    findAgentDirs(p, depth + 1, out);
  }
  return out;
}

const master = readFileSync(MASTER);
const dirs = findAgentDirs(PROJECTS_ROOT, 0, []).filter((d) => d !== join(PROJECTS_ROOT, 'trading-forge', 'trading-forge', '.claude', 'agents'));
let wrote = 0;
for (const d of dirs) {
  const target = join(d, 'accuracy-validator.md');
  if (!existsSync(target)) continue; // only refresh trees that already carry the agent
  if (APPLY) { writeFileSync(target, master); wrote++; console.log('WROTE ' + target); }
  else console.log('WOULD WRITE ' + target);
}
console.log(`${APPLY ? 'wrote' : 'would write'} ${APPLY ? wrote : dirs.length} target dirs scanned=${dirs.length}`);
