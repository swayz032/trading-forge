#!/usr/bin/env node
// routing_inventory_e0.mjs — AR-1255 §8 Wave E0 read-only routing census.
//
// WHY THIS EXISTS AND WHAT IT IS NOT:
//   `check-agent-parity.mjs` (pinned toolbox, master = trading-forge/trading-forge)
//   hashes agent CONTENT and reports drift. It says NOTHING about which MODEL an
//   agent resolves to. Model routing is the AR-1255 subject, so this census adds
//   exactly that dimension and REUSES parity's walker shape rather than restating
//   its drift verdict. Run `check-agent-parity.mjs` for drift; run this for routing.
//
// READ-ONLY. Writes one JSON artifact. Mutates no agent, skill, or G2 file.
// Exit 0 always — this is a baseline, not a gate. E1/E2 own the gating.
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const PROJECTS_ROOT = 'C:\\Users\\tonio\\Projects';
const CONTAINER = join(PROJECTS_ROOT, 'trading-forge');
const MASTER_DIR = join(CONTAINER, 'trading-forge', '.claude', 'agents');
const USER_CLAUDE = 'C:\\Users\\tonio\\.claude';
const SKIP = new Set(['node_modules', '.git', '.pytest_cache', '.ruff_cache', 'dist']);
const MAX_DEPTH = 6;

// --- frontmatter ------------------------------------------------------------
// Only the FIRST --- block. A `model:` outside it is prose, not configuration.
function frontmatter(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { __no_frontmatter: true };
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return out;
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[i]);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out; // unterminated block — still report what we parsed
}

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
      findAgentDirs(p, depth + 1, out); // registered worktrees nest their own .claude
      continue;
    }
    findAgentDirs(p, depth + 1, out);
  }
  return out;
}

// --- agents -----------------------------------------------------------------
const agentDirs = findAgentDirs(PROJECTS_ROOT, 0, []);
const byAgent = new Map();      // name -> [{tree, model, explicit, bytes}]
const nonAgentFiles = [];       // files under .claude/agents that are NOT agent defs

// Collect .md files under an agents dir. Top level = agent definitions. NESTED is
// load-bearing and was a false negative in the first run of this script: three
// agent-memory payloads live at .claude/agents/.claude/agent-memory/<agent>/*.md
// and the harness surfaces them as dispatchable agent types. A walker that only
// reads the top level reports "0 pollution" while the roster disagrees.
function agentMdFiles(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) agentMdFiles(join(dir, e.name), depth + 1, out); }
    else if (e.name.endsWith('.md')) out.push({ full: join(dir, e.name), nested: depth > 0 });
  }
  return out;
}

for (const dir of agentDirs) {
  for (const { full, nested } of agentMdFiles(dir)) {
    const f = { name: basename(full) };
    const fm = frontmatter(full);
    if (!fm) continue;
    const name = fm.name || basename(f.name, '.md');
    // An agent-memory payload carries `metadata:` + no tools/model and lives under
    // an agent-memory path. It is NOT a dispatchable agent, but a scanner that
    // globs .claude/agents/**.md will surface it as one.
    // Two independent signals, either of which disqualifies a file as an agent def:
    // it sits below the agents dir root, or it carries a memory `metadata:` block
    // instead of the tools/model fields a dispatchable agent declares.
    const isMemory = nested || /agent-memory/i.test(full) || (fm.metadata !== undefined && fm.model === undefined && fm.tools === undefined);
    if (isMemory) {
      nonAgentFiles.push({
        path: full,
        declared_name: name,
        nested_below_agents_root: nested,
        reason: 'not an agent definition — surfaced as a dispatchable agent type by a .claude/agents scan',
      });
      continue;
    }
    if (!byAgent.has(name)) byAgent.set(name, []);
    byAgent.get(name).push({
      tree: dir,
      is_master: dir === MASTER_DIR,
      model: fm.model ?? null,
      explicit: Object.prototype.hasOwnProperty.call(fm, 'model'),
      bytes: statSync(full).size,
    });
  }
}

const agents = [...byAgent.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, copies]) => {
  const distinct = [...new Set(copies.map((c) => (c.explicit ? c.model : 'INHERITS_PARENT')))].sort();
  const master = copies.find((c) => c.is_master) || null;
  return {
    name,
    copies: copies.length,
    distinct_routing: distinct,
    routing_consistent: distinct.length === 1,
    master_model: master ? (master.explicit ? master.model : 'INHERITS_PARENT') : 'NO_MASTER_COPY',
    inherits_parent_in: copies.filter((c) => !c.explicit).map((c) => c.tree),
  };
});

// --- skills -----------------------------------------------------------------
function skillCensus(root, ownership) {
  const dir = join(root, '.claude', 'skills');
  const alt = join(root, 'skills');
  const base = existsSync(dir) ? dir : existsSync(alt) ? alt : null;
  if (!base) return [];
  const out = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const f = join(base, e.name, 'SKILL.md');
    if (existsSync(f)) out.push({ name: e.name, ownership, bytes: statSync(f).size, path: f });
    else { // one nesting level (bundled skill packs)
      const inner = join(base, e.name, 'skills');
      if (!existsSync(inner)) continue;
      for (const i of readdirSync(inner, { withFileTypes: true })) {
        const g = join(inner, i.name, 'SKILL.md');
        if (existsSync(g)) out.push({ name: `${e.name}/${i.name}`, ownership, bytes: statSync(g).size, path: g });
      }
    }
  }
  return out;
}
const skills = [...skillCensus(CONTAINER, 'project'), ...skillCensus(USER_CLAUDE, 'user')]
  .sort((a, b) => b.bytes - a.bytes);

// --- hooks ------------------------------------------------------------------
function hookCensus(path) {
  if (!existsSync(path)) return { path, present: false };
  let d;
  try { d = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return { path, present: true, parse_error: String(e) }; }
  const h = d.hooks || {};
  return { path, present: true, events: Object.keys(h), matchers: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.map((m) => m.matcher ?? '*')])) };
}
const hooks = [
  hookCensus(join(CONTAINER, '.claude', 'settings.json')),
  hookCensus(join(CONTAINER, '.claude', 'settings.local.json')),
  hookCensus(join(USER_CLAUDE, 'settings.json')),
];
const allEvents = new Set(hooks.flatMap((h) => h.events || []));

const report = {
  wave: 'E0',
  ruling: 'AR-1255 §8 (GPT context-budget / model-router activation)',
  kind: 'READ-ONLY ROUTING BASELINE — not a gate, not an activation claim',
  claim_contract: 'AR-1255 §10 — nothing here is ROUTED, PROVEN, SAVED or ACTIVE. CONFIGURED only.',
  agents: {
    definition_dirs_found: agentDirs.length,
    master_dir: MASTER_DIR,
    distinct_agents: agents.length,
    inconsistent_routing: agents.filter((a) => !a.routing_consistent).map((a) => a.name),
    detail: agents,
  },
  non_agent_files_in_agent_dirs: nonAgentFiles,
  skills: { count: skills.length, detail: skills },
  hooks: {
    detail: hooks,
    session_rotation_capability: {
      SessionStart_configured: allEvents.has('SessionStart'),
      Stop_configured: allEvents.has('Stop'),
      SubagentStop_configured: allEvents.has('SubagentStop'),
      // AR-1255 §3.4 wants packet-complete / fresh-session-required markers.
      verdict: allEvents.has('SessionStart') ? 'PARTIAL_OR_PRESENT' : 'NOT_CONFIGURED',
    },
  },
};

const outPath = process.argv[2];
if (!outPath) { console.error('usage: node scripts/routing_inventory_e0.mjs <out.json>'); process.exit(2); }
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`agent definition dirs : ${agentDirs.length}`);
console.log(`distinct agents       : ${agents.length}`);
console.log(`inconsistent routing  : ${report.agents.inconsistent_routing.length ? report.agents.inconsistent_routing.join(', ') : 'none'}`);
console.log(`non-agent files       : ${nonAgentFiles.length}`);
console.log(`skills                : ${skills.length}`);
console.log(`session rotation      : ${report.hooks.session_rotation_capability.verdict}`);
console.log(`wrote ${outPath}`);
