#!/usr/bin/env node
// Refresh ONLY the freshness (epoch) fields of a V4 Phase-1 execution graph so the
// validator's join contract can be satisfied against a named campaign commit.
//
// It rewrites nothing else: node states, edges, fan-ins, evidence pins and the
// blueprint authority pin are LEFT ALONE. If a node state has gone stale, this
// script cannot and must not hide it -- refreshing the epoch is only honest when
// the partition is still true, and that judgement belongs to the desk, not here.
//
// Every value is COMPUTED from git. Nothing is hand-copied.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i += 2) out[argv[i]] = argv[i + 1];
  return out;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function firstHeading(text, kind) {
  return text.match(new RegExp(`^## (${kind}-\\d+)\\b`, 'm'))?.[1] ?? null;
}

const cli = parseArgs(process.argv.slice(2));
const graphPath = cli['--graph'];
const root = cli['--campaign-root'];
const write = process.argv.includes('--write');

if (!graphPath || !root) {
  console.error('usage: refresh-v4-epoch.mjs --graph <json> --campaign-root <worktree> [--write]');
  process.exit(2);
}

const REPORT = 'docs/designs/AGENT-REPORTS.md';
const RULING = 'docs/designs/ADVISOR-RULINGS.md';
const STATE = 'docs/designs/ADVISOR-STATE.md';

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

const head = git(root, ['rev-parse', 'HEAD']);
const epoch = {
  status_join_commit: head,
  status_epoch_report_commit: git(root, ['log', '-1', '--format=%H', '--', REPORT]),
  status_epoch_ruling_commit: git(root, ['log', '-1', '--format=%H', '--', RULING]),
  advisor_state_git_blob_oid: git(root, ['rev-parse', `HEAD:${STATE}`]),
  status_epoch_report: firstHeading(fs.readFileSync(`${root}/${REPORT}`, 'utf8'), 'AR'),
  status_epoch_ruling: firstHeading(fs.readFileSync(`${root}/${RULING}`, 'utf8'), 'R'),
};

const blobPins = {
  EPOCH_STATE: git(root, ['rev-parse', `HEAD:${STATE}`]),
  EPOCH_RULINGS: git(root, ['rev-parse', `HEAD:${RULING}`]),
  EPOCH_REPORTS: git(root, ['rev-parse', `HEAD:${REPORT}`]),
};

const changes = [];
for (const [field, value] of Object.entries(epoch)) {
  if (graph.authority[field] !== value) {
    changes.push([`authority.${field}`, graph.authority[field], value]);
    graph.authority[field] = value;
  }
}
for (const pin of graph.artifact_pins) {
  if (Object.hasOwn(blobPins, pin.id) && pin.git_blob_oid !== blobPins[pin.id]) {
    changes.push([`pin.${pin.id}`, pin.git_blob_oid, blobPins[pin.id]]);
    pin.git_blob_oid = blobPins[pin.id];
  }
}

// The join CONDITION is prose that names the epoch. A caption is a claim: if the
// numbers move and the sentence does not, the sentence becomes false.
const condition =
  `ADVISOR-STATE, newest report ${epoch.status_epoch_report}, and newest ruling ` +
  `${epoch.status_epoch_ruling} are joined at campaign commit ${head}. Any later ` +
  `campaign commit, AR, ruling, or state rewrite invalidates node states until the ` +
  `graph is refreshed. Refreshing this epoch asserts FRESHNESS ONLY -- it does not ` +
  `re-verify that the node-state partition is still true, which remains a desk judgement.`;
if (graph.authority.status_join_condition !== condition) {
  changes.push(['authority.status_join_condition', '<prose>', '<prose, rewritten>']);
  graph.authority.status_join_condition = condition;
}

for (const [field, from, to] of changes) {
  console.log(`${field}\n    ${from}\n -> ${to}`);
}
console.log(`\n${changes.length} field(s) refreshed at campaign HEAD ${head}`);

if (write) {
  fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  console.log(`WROTE ${graphPath}`);
} else {
  console.log('DRY RUN — pass --write to persist');
}
