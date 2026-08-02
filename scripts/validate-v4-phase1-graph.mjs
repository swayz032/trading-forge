#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CANONICAL_PHASE_1_EXIT = '≥1 tier-A spec compiles with ALL load-bearing conditions concretely bound AND the compile-fidelity forensics gate passes calibration.';
const STATE_BUCKETS = [
  'completed',
  'active_worker',
  'ready_advisor',
  'blocked',
  'conditional',
  'parked',
  'operator_reserved',
];
const EXPECTED_FAN_INS = {
  GBP: ['P0IG', 'P1', 'P2', 'P3', 'REG'],
  GBR: ['GBP', 'P3'],
  GBS: ['GBR', 'P1', 'P2'],
  FIDELITY: ['BIND', 'P0IG'],
  PH1_EXIT: ['BIND', 'FIDELITY', 'P0IG'],
};
const REQUIRED_ARTIFACT_PATHS = [
  'docs/designs/P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md',
  'docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json',
  'docs/designs/GRADE-P1-P2-RECENSUS-2026-08-01.md',
  'docs/designs/ADVISOR-STATE.md',
  'docs/designs/ADVISOR-RULINGS.md',
  'docs/designs/AGENT-REPORTS.md',
];
const REQUIRED_MUTATION_EDGES = new Set(['P0PC->P0PG', 'P0VC->P0DG', 'P0I->P0IG']);

function parseArgs(argv) {
  const out = {};
  if (argv.length % 2 !== 0) return out;
  for (let i = 0; i < argv.length; i += 2) out[argv[i]] = argv[i + 1];
  return out;
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function addError(errors, code, message, detail = {}) {
  errors.push({ code, message, ...detail });
}

function firstHeadingId(contents, kind) {
  const match = contents.match(new RegExp(`^## (${kind}-\\d+)\\b`, 'm'));
  return match?.[1] ?? null;
}

function descendantCount(start, outgoing) {
  const seen = new Set();
  const pending = [...(outgoing.get(start) ?? [])];
  while (pending.length) {
    const id = pending.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }
  return seen.size;
}

const cli = parseArgs(process.argv.slice(2));
const graphPath = cli['--graph'];
const campaignRoot = cli['--campaign-root'];

if (!graphPath || !campaignRoot) {
  console.error('usage: validate-v4-phase1-graph.mjs --graph <json> --campaign-root <git-worktree>');
  process.exit(2);
}

let graph;
try {
  graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
} catch (error) {
  console.log(JSON.stringify({ verdict: 'FAIL', errors: [{ code: 'GRAPH_UNREADABLE', message: error.message }], error_codes: ['GRAPH_UNREADABLE'] }, null, 2));
  process.exit(1);
}

const errors = [];
const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
const edges = Array.isArray(graph.edges) ? graph.edges : [];
const ids = nodes.map((node) => node.id);
const idSet = new Set(ids);
const nodesById = new Map(nodes.map((node) => [node.id, node]));
const states = graph.node_states_at_epoch ?? {};
const completed = new Set(states.completed ?? []);
const campaignHead = git(campaignRoot, ['rev-parse', 'HEAD']);
let artifactPinsChecked = 0;
let evidenceRefsChecked = 0;

if (new Set(ids).size !== ids.length) {
  addError(errors, 'DUPLICATE_NODE_ID', 'node IDs must be unique');
}

for (const node of nodes) {
  for (const field of ['id', 'kind', 'phase', 'state_at_epoch', 'owner', 'wip_class', 'acceptance']) {
    if (typeof node[field] !== 'string' || node[field].trim() === '') {
      addError(errors, 'UNCLASSIFIED_NODE', `node ${node.id ?? '<missing>'} lacks classifying field ${field}`);
    }
  }
  if (!Array.isArray(node.outputs) || node.outputs.length === 0) {
    addError(errors, 'UNCLASSIFIED_NODE', `node ${node.id ?? '<missing>'} lacks an output contract`);
  }
}

for (const edge of edges) {
  if (!idSet.has(edge.from) || !idSet.has(edge.to)) {
    addError(errors, 'MISSING_EDGE_ENDPOINT', `edge ${edge.from} -> ${edge.to} references a missing node`);
  }
  if (edge.hard && (typeof edge.artifact !== 'string' || edge.artifact.trim() === '')) {
    addError(errors, 'HARD_EDGE_ARTIFACT_MISSING', `hard edge ${edge.from} -> ${edge.to} must name its artifact`);
  }
}

const indegree = new Map([...idSet].map((id) => [id, 0]));
const outgoing = new Map([...idSet].map((id) => [id, []]));
for (const edge of edges) {
  if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
  outgoing.get(edge.from).push(edge.to);
  indegree.set(edge.to, indegree.get(edge.to) + 1);
}
const topoQueue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
let visited = 0;
while (topoQueue.length) {
  const id = topoQueue.shift();
  visited += 1;
  for (const target of outgoing.get(id)) {
    indegree.set(target, indegree.get(target) - 1);
    if (indegree.get(target) === 0) topoQueue.push(target);
  }
}
if (visited !== idSet.size) addError(errors, 'GRAPH_CYCLE', 'graph must be acyclic');

const unknownBuckets = Object.keys(states).filter((bucket) => !STATE_BUCKETS.includes(bucket));
const missingBuckets = STATE_BUCKETS.filter((bucket) => !Array.isArray(states[bucket]));
if (unknownBuckets.length) {
  addError(errors, 'UNCLASSIFIED_NODE_STATE', 'unknown epoch-state bucket fails closed', { unknown_buckets: unknownBuckets });
}
if (missingBuckets.length) {
  addError(errors, 'NODE_STATE_BUCKET_MISSING', 'every canonical state bucket must exist', { missing_buckets: missingBuckets });
}

const stateCounts = new Map();
for (const bucket of STATE_BUCKETS) {
  for (const id of states[bucket] ?? []) stateCounts.set(id, (stateCounts.get(id) ?? 0) + 1);
}
const missingStates = [...idSet].filter((id) => !stateCounts.has(id));
const duplicateStates = [...stateCounts].filter(([, count]) => count !== 1).map(([id]) => id);
const unknownStates = [...stateCounts.keys()].filter((id) => !idSet.has(id));
if (missingStates.length || duplicateStates.length || unknownStates.length) {
  addError(errors, 'NODE_STATE_PARTITION_INVALID', 'every node must appear in exactly one epoch-state bucket', {
    missing: missingStates,
    duplicated: duplicateStates,
    unknown: unknownStates,
  });
}

const derivedFields = [];
for (const field of ['ready_worker_nodes_at_epoch', 'ready_advisor_nodes_at_epoch']) {
  if (Object.hasOwn(graph.scheduler ?? {}, field)) derivedFields.push(`scheduler.${field}`);
}
if (Object.hasOwn(graph, 'recommended_parallel_batch_now')) derivedFields.push('recommended_parallel_batch_now');
if (derivedFields.length) {
  addError(errors, 'DERIVED_FIELD_HAND_AUTHORED', 'ready sets and recommended batches must be validator output, not graph input', { fields: derivedFields });
}

const pinById = new Map();
const pinPaths = new Set();
for (const [index, pin] of (graph.artifact_pins ?? []).entries()) {
  const pinId = pin.id ?? `legacy-pin-${index}`;
  if (pinById.has(pinId)) addError(errors, 'DUPLICATE_ARTIFACT_PIN_ID', `duplicate artifact pin id ${pinId}`);
  pinById.set(pinId, pin);
  if (pin.path) pinPaths.add(pin.path);
  let actual = null;
  if ((pin.kind ?? 'git_blob') === 'git_commit') {
    actual = git(campaignRoot, ['rev-parse', `${pin.commit_oid}^{commit}`]);
    if (actual !== pin.commit_oid) {
      addError(errors, 'ARTIFACT_PIN_MISMATCH', `commit pin mismatch for ${pinId}`, { expected: pin.commit_oid, actual });
    }
  } else if (pin.kind === 'git_object') {
    actual = git(campaignRoot, ['cat-file', '-t', pin.object_oid]);
    if (actual !== pin.object_type) {
      addError(errors, 'ARTIFACT_PIN_MISMATCH', `git object pin mismatch for ${pinId}`, { expected: `${pin.object_oid}:${pin.object_type}`, actual });
    }
  } else {
    actual = git(campaignRoot, ['rev-parse', `HEAD:${pin.path}`]);
    if (actual !== pin.git_blob_oid) {
      addError(errors, 'ARTIFACT_PIN_MISMATCH', `artifact pin mismatch for ${pin.path}`, { expected: pin.git_blob_oid, actual });
    }
  }
  artifactPinsChecked += 1;
}
const missingRequiredPins = REQUIRED_ARTIFACT_PATHS.filter((required) => !pinPaths.has(required));
if (missingRequiredPins.length) {
  addError(errors, 'REQUIRED_ARTIFACT_PIN_MISSING', 'required evidence pins may not disappear with the evidence', { missing: missingRequiredPins });
}

const authorityPins = [
  ['requirements', graph.authority?.requirements_source, graph.authority?.requirements_source_git_blob_oid],
  ['dependency', graph.authority?.dependency_source, graph.authority?.dependency_source_git_blob_oid],
];
for (const [name, source, expected] of authorityPins) {
  const actual = source ? git(campaignRoot, ['rev-parse', `HEAD:${source}`]) : null;
  if (!source || !expected || actual !== expected) {
    addError(errors, 'AUTHORITY_PIN_MISMATCH', `${name} authority pin must match the campaign artifact`, { source, expected, actual });
  }
}

const epochFields = [
  'advisor_state_git_blob_oid',
  'status_epoch_report_commit',
  'status_epoch_report',
  'status_epoch_ruling_commit',
  'status_epoch_ruling',
  'status_join_commit',
];
const missingEpochFields = epochFields.filter((field) => typeof graph.authority?.[field] !== 'string' || graph.authority[field].trim() === '');
if (missingEpochFields.length) addError(errors, 'EPOCH_FIELD_MISSING', 'state snapshot lacks a complete epoch', { missing: missingEpochFields });

const reportPath = 'docs/designs/AGENT-REPORTS.md';
const rulingPath = 'docs/designs/ADVISOR-RULINGS.md';
const statePath = 'docs/designs/ADVISOR-STATE.md';
const actualReportCommit = git(campaignRoot, ['log', '-1', '--format=%H', '--', reportPath]);
const actualRulingCommit = git(campaignRoot, ['log', '-1', '--format=%H', '--', rulingPath]);
const actualStateBlob = git(campaignRoot, ['rev-parse', `HEAD:${statePath}`]);
if (graph.authority?.status_join_commit !== campaignHead) {
  addError(errors, 'EPOCH_JOIN_MISMATCH', 'status join commit must equal the campaign commit being validated', { expected: graph.authority?.status_join_commit, actual: campaignHead });
}
if (graph.authority?.status_epoch_report_commit !== actualReportCommit) {
  addError(errors, 'EPOCH_REPORT_MISMATCH', 'report epoch commit is stale', { expected: graph.authority?.status_epoch_report_commit, actual: actualReportCommit });
}
if (graph.authority?.status_epoch_ruling_commit !== actualRulingCommit) {
  addError(errors, 'EPOCH_RULING_MISMATCH', 'ruling epoch commit is stale', { expected: graph.authority?.status_epoch_ruling_commit, actual: actualRulingCommit });
}
if (graph.authority?.advisor_state_git_blob_oid !== actualStateBlob) {
  addError(errors, 'EPOCH_STATE_MISMATCH', 'advisor-state blob is stale', { expected: graph.authority?.advisor_state_git_blob_oid, actual: actualStateBlob });
}
try {
  const newestReport = firstHeadingId(fs.readFileSync(path.join(campaignRoot, reportPath), 'utf8'), 'AR');
  const newestRuling = firstHeadingId(fs.readFileSync(path.join(campaignRoot, rulingPath), 'utf8'), 'R');
  if (newestReport !== graph.authority?.status_epoch_report) {
    addError(errors, 'EPOCH_REPORT_LABEL_MISMATCH', 'report epoch label is stale', { expected: graph.authority?.status_epoch_report, actual: newestReport });
  }
  if (newestRuling !== graph.authority?.status_epoch_ruling) {
    addError(errors, 'EPOCH_RULING_LABEL_MISMATCH', 'ruling epoch label is stale', { expected: graph.authority?.status_epoch_ruling, actual: newestRuling });
  }
} catch (error) {
  addError(errors, 'EPOCH_SOURCE_UNREADABLE', `epoch source unreadable: ${error.message}`);
}

const incomingHardEdges = {};
for (const edge of edges.filter((candidate) => candidate.hard)) {
  (incomingHardEdges[edge.to] ??= []).push(edge);
}
const actualFanIns = Object.fromEntries(
  Object.entries(incomingHardEdges).filter(([, incoming]) => incoming.length > 1).map(([target, incoming]) => [target, incoming.map((edge) => edge.from)]),
);
const declaredFanIns = graph.fan_in_contracts ?? {};
const fanInTargets = new Set([...Object.keys(actualFanIns), ...Object.keys(declaredFanIns)]);
for (const target of fanInTargets) {
  const actual = actualFanIns[target] ?? [];
  const declared = declaredFanIns[target] ?? [];
  if (!sameSet(actual, declared)) {
    addError(errors, 'FAN_IN_CONTRACT_MISMATCH', `fan-in contract for ${target} must equal its hard-edge predecessors`, { actual: [...actual].sort(), declared: [...declared].sort() });
  }
}
for (const [target, expected] of Object.entries(EXPECTED_FAN_INS)) {
  const declared = declaredFanIns[target] ?? [];
  if (!sameSet(expected, declared)) {
    addError(errors, 'FAN_IN_LITERAL_MISMATCH', `fan-in for ${target} differs from the independently registered authority`, { expected: [...expected].sort(), actual: [...declared].sort() });
  }
}
const undeclaredLiteralFanIns = Object.keys(declaredFanIns).filter((target) => !Object.hasOwn(EXPECTED_FAN_INS, target));
if (undeclaredLiteralFanIns.length) {
  addError(errors, 'FAN_IN_LITERAL_MISMATCH', 'new fan-in targets require an independent validator update', { targets: undeclaredLiteralFanIns });
}

for (const edge of edges.filter((candidate) => candidate.hard && completed.has(candidate.from))) {
  const refs = edge.evidence_ref_ids ?? [];
  if (!Array.isArray(refs) || refs.length === 0) {
    addError(errors, 'COMPLETED_EDGE_EVIDENCE_MISSING', `completed edge ${edge.from} -> ${edge.to} lacks pinned evidence refs`);
    continue;
  }
  for (const ref of refs) {
    evidenceRefsChecked += 1;
    if (!pinById.has(ref)) addError(errors, 'UNRESOLVED_EVIDENCE_REF', `edge ${edge.from} -> ${edge.to} references unknown pin ${ref}`);
  }
}

const markedMutationEdges = new Set(edges.filter((edge) => edge.mutation_bearing).map((edge) => `${edge.from}->${edge.to}`));
for (const expected of REQUIRED_MUTATION_EDGES) {
  if (!markedMutationEdges.has(expected)) addError(errors, 'MUTATION_EDGE_UNMARKED', `required mutation-bearing edge ${expected} is not marked`);
}
for (const edge of edges.filter((candidate) => candidate.mutation_bearing && completed.has(candidate.from))) {
  const compilerRefs = edge.compiler_surface_pin_ids ?? [];
  const ownerRefs = edge.ownership_manifest_pin_ids ?? [];
  const allRefs = [...compilerRefs, ...ownerRefs];
  if (!compilerRefs.length || !ownerRefs.length || allRefs.some((ref) => !pinById.has(ref))) {
    addError(errors, 'MUTATION_EDGE_CONTRACT_MISSING', `completed mutation edge ${edge.from} -> ${edge.to} lacks compiler-surface or primary-owner evidence`, {
      compiler_surface_pin_ids: compilerRefs,
      ownership_manifest_pin_ids: ownerRefs,
    });
  }
}

const readyWorkerNodes = [...(states.active_worker ?? [])];
const readyAdvisorNodes = [...(states.ready_advisor ?? [])];
const allReady = [...readyWorkerNodes, ...readyAdvisorNodes];
for (const id of allReady) {
  const incomplete = (incomingHardEdges[id] ?? []).filter((edge) => !completed.has(edge.from)).map((edge) => edge.from);
  if (incomplete.length) addError(errors, 'READY_HARD_PREDECESSOR_INCOMPLETE', `ready node ${id} has incomplete hard predecessors`, { incomplete });
}
const reenteredEvidence = allReady.filter((id) => id === 'P1' || id === 'P2');
if (reenteredEvidence.length) {
  addError(errors, 'COMPLETED_EVIDENCE_REENTERED_READY', 'P1 and P2 are completed evidence and cannot re-enter ready work', { nodes: reenteredEvidence });
}
if (readyWorkerNodes.length > graph.scheduler?.max_worker_lanes) {
  addError(errors, 'ACTIVE_LANE_LIMIT_EXCEEDED', `worker ready count ${readyWorkerNodes.length} exceeds limit ${graph.scheduler?.max_worker_lanes}`, { nodes: readyWorkerNodes });
}
if (graph.scheduler?.judgment_is_never_a_worker_lane) {
  const judgmentWorkers = readyWorkerNodes.filter((id) => nodesById.get(id)?.kind === 'judgment');
  if (judgmentWorkers.length) addError(errors, 'JUDGMENT_SCHEDULED_AS_WORKER', 'judgment nodes may not enter worker lanes', { nodes: judgmentWorkers });
}
for (const [wipClass, limit] of [
  ['money_path_implementation', graph.scheduler?.max_money_path_implementations],
  ['independent_grade', graph.scheduler?.max_independent_grades],
]) {
  const active = readyWorkerNodes.filter((id) => nodesById.get(id)?.wip_class === wipClass);
  if (active.length > limit) addError(errors, 'ACTIVE_LANE_LIMIT_EXCEEDED', `${wipClass} ready count ${active.length} exceeds limit ${limit}`, { nodes: active });
}

const offPathClasses = new Set(['off_critical_path', 'shared_resource']);
const priority = (leftId, rightId) => {
  const left = nodesById.get(leftId);
  const right = nodesById.get(rightId);
  const leftMoney = offPathClasses.has(left?.wip_class) ? 0 : 1;
  const rightMoney = offPathClasses.has(right?.wip_class) ? 0 : 1;
  if (leftMoney !== rightMoney) return rightMoney - leftMoney;
  const fanoutDelta = descendantCount(rightId, outgoing) - descendantCount(leftId, outgoing);
  return fanoutDelta || leftId.localeCompare(rightId);
};
const recommendedWorkerBatch = [...readyWorkerNodes].sort(priority).slice(0, graph.scheduler?.max_worker_lanes ?? 0);
const recommendedAdvisorClock = [...readyAdvisorNodes].sort(priority);
const parkedForCapacity = readyWorkerNodes.filter((id) => !recommendedWorkerBatch.includes(id));

let phaseExitVerified = false;
try {
  const blueprint = fs.readFileSync(path.join(campaignRoot, graph.authority.requirements_source), 'utf8').replace(/\s+/g, ' ');
  phaseExitVerified = graph.objective?.phase_1_exit === CANONICAL_PHASE_1_EXIT && blueprint.includes(CANONICAL_PHASE_1_EXIT);
} catch {
  phaseExitVerified = false;
}
if (!phaseExitVerified) {
  addError(errors, 'PHASE_EXIT_MISMATCH', 'graph Phase-1 exit must equal the blueprint authority verbatim');
}

const receipt = {
  verdict: errors.length ? 'FAIL' : 'PASS',
  errors,
  error_codes: errors.map((error) => error.code),
  graph: path.resolve(graphPath),
  schema_version: graph.schema_version,
  node_count: ids.length,
  edge_count: edges.length,
  ready_worker_nodes: readyWorkerNodes,
  ready_advisor_nodes: readyAdvisorNodes,
  recommended_worker_batch: recommendedWorkerBatch,
  recommended_advisor_clock: recommendedAdvisorClock,
  parked_for_capacity: parkedForCapacity,
  completed_evidence_nodes: ['P1', 'P2'].filter((id) => completed.has(id)),
  artifact_pins_checked: artifactPinsChecked,
  evidence_refs_checked: evidenceRefsChecked,
  phase_1_exit_verified: phaseExitVerified,
  epoch_verified: !errors.some((error) => error.code.startsWith('EPOCH_') || error.code === 'ARTIFACT_PIN_MISMATCH' || error.code === 'AUTHORITY_PIN_MISMATCH'),
  epoch_join_commit: graph.authority?.status_join_commit,
  campaign_head: campaignHead,
};

console.log(JSON.stringify(receipt, null, 2));
process.exit(errors.length ? 1 : 0);
