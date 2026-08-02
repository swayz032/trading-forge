import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);
const validator = path.join(here, 'validate-v4-phase1-graph.mjs');
const graph = process.env.TF_V4_GRAPH
  ?? path.join(repoRoot, 'docs', 'advisor-rulings', 'V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json');
const campaignRoot = process.env.TF_V4_CAMPAIGN_ROOT
  ?? path.resolve(repoRoot, '..', 'wt-h1-wave4-20260712');

assert.ok(fs.existsSync(graph), `graph fixture missing: ${graph}`);
assert.ok(fs.existsSync(campaignRoot), `campaign root missing: ${campaignRoot}`);

const result = spawnSync(process.execPath, [validator, '--graph', graph, '--campaign-root', campaignRoot], {
  cwd: repoRoot,
  encoding: 'utf8',
});

assert.equal(
  result.status,
  0,
  `clean graph must be admitted; exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
);

const receipt = JSON.parse(result.stdout);
assert.equal(receipt.verdict, 'PASS');
assert.deepEqual(receipt.ready_worker_nodes, ['P0PC']);
assert.deepEqual(receipt.ready_advisor_nodes, ['P3']);
assert.deepEqual(receipt.recommended_worker_batch, ['P0PC']);
assert.deepEqual(receipt.recommended_advisor_clock, ['P3']);
assert.deepEqual(receipt.completed_evidence_nodes.sort(), ['P1', 'P2']);
assert.equal(receipt.phase_1_exit_verified, true);
assert.equal(receipt.epoch_verified, true);

console.log('PASS clean graph admitted with P0PC ready and P1/P2 completed');

const baseline = JSON.parse(fs.readFileSync(graph, 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'v4-graph-test-'));

function runMutation(name, mutate) {
  const candidate = structuredClone(baseline);
  mutate(candidate);
  const candidatePath = path.join(temp, `${name}.json`);
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  const run = spawnSync(process.execPath, [validator, '--graph', candidatePath, '--campaign-root', campaignRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { ...run, receipt: JSON.parse(run.stdout) };
}

function moveState(candidate, id, from, to) {
  candidate.node_states_at_epoch[from] = candidate.node_states_at_epoch[from].filter((member) => member !== id);
  candidate.node_states_at_epoch[to].push(id);
}

const duplicate = runMutation('duplicate-node', (candidate) => {
  candidate.nodes.push(structuredClone(candidate.nodes[0]));
});
assert.equal(duplicate.status, 1, 'duplicate node ID must deny the graph');
assert.ok(duplicate.receipt.error_codes.includes('DUPLICATE_NODE_ID'));
console.log('PASS duplicate node ID denied');

const danglingEdge = runMutation('dangling-edge', (candidate) => {
  candidate.edges[0].to = 'NODE_THAT_DOES_NOT_EXIST';
});
assert.equal(danglingEdge.status, 1, 'edge with a missing endpoint must deny the graph');
assert.ok(danglingEdge.receipt.error_codes.includes('MISSING_EDGE_ENDPOINT'));
console.log('PASS missing edge endpoint denied');

const blankHardArtifact = runMutation('blank-hard-artifact', (candidate) => {
  candidate.edges.find((edge) => edge.hard).artifact = '   ';
});
assert.equal(blankHardArtifact.status, 1, 'hard edge without an artifact must deny the graph');
assert.ok(blankHardArtifact.receipt.error_codes.includes('HARD_EDGE_ARTIFACT_MISSING'));
console.log('PASS blank hard-edge artifact denied');

const cycle = runMutation('cycle', (candidate) => {
  candidate.edges.push({ from: candidate.nodes[0].id, to: candidate.nodes[0].id, type: 'control', hard: false });
});
assert.equal(cycle.status, 1, 'cycle must deny the graph');
assert.ok(cycle.receipt.error_codes.includes('GRAPH_CYCLE'));
console.log('PASS graph cycle denied');

const missingState = runMutation('missing-node-state', (candidate) => {
  candidate.node_states_at_epoch.blocked.pop();
});
assert.equal(missingState.status, 1, 'node missing from the epoch partition must deny the graph');
assert.ok(missingState.receipt.error_codes.includes('NODE_STATE_PARTITION_INVALID'));
console.log('PASS missing node state denied');

const duplicateState = runMutation('duplicate-node-state', (candidate) => {
  candidate.node_states_at_epoch.blocked.push(candidate.node_states_at_epoch.completed[0]);
});
assert.equal(duplicateState.status, 1, 'node in two epoch buckets must deny the graph');
assert.ok(duplicateState.receipt.error_codes.includes('NODE_STATE_PARTITION_INVALID'));

const unknownState = runMutation('unknown-node-state', (candidate) => {
  candidate.node_states_at_epoch.blocked.push('NODE_THAT_DOES_NOT_EXIST');
});
assert.equal(unknownState.status, 1, 'unknown identity in the epoch partition must deny the graph');
assert.ok(unknownState.receipt.error_codes.includes('NODE_STATE_PARTITION_INVALID'));
console.log('PASS duplicate and unknown node states denied');

const fanInMismatch = runMutation('fan-in-mismatch', (candidate) => {
  candidate.fan_in_contracts.GBP = candidate.fan_in_contracts.GBP.filter((id) => id !== 'P1');
});
assert.equal(fanInMismatch.status, 1, 'fan-in contract that omits a hard predecessor must deny the graph');
assert.ok(fanInMismatch.receipt.error_codes.includes('FAN_IN_CONTRACT_MISMATCH'));
console.log('PASS fan-in contract mismatch denied');

const jointFanInDeletion = runMutation('joint-fan-in-deletion', (candidate) => {
  candidate.edges = candidate.edges.filter((edge) => !(edge.from === 'P2' && edge.to === 'GBP'));
  candidate.fan_in_contracts.GBP = candidate.fan_in_contracts.GBP.filter((id) => id !== 'P2');
});
assert.equal(jointFanInDeletion.status, 1, 'jointly deleting an edge and its in-graph expectation must deny');
assert.ok(jointFanInDeletion.receipt.error_codes.includes('FAN_IN_LITERAL_MISMATCH'));
console.log('PASS independent literal fan-in authority denies joint deletion');

const handAuthoredDerivedField = runMutation('hand-authored-derived-field', (candidate) => {
  candidate.scheduler.ready_worker_nodes_at_epoch = ['P0PG'];
});
assert.equal(handAuthoredDerivedField.status, 1, 'a hand-authored ready set must deny');
assert.ok(handAuthoredDerivedField.receipt.error_codes.includes('DERIVED_FIELD_HAND_AUTHORED'));
console.log('PASS hand-authored derived ready set denied');

const incompleteReadyPredecessor = runMutation('ready-with-incomplete-predecessor', (candidate) => {
  candidate.node_states_at_epoch.completed = candidate.node_states_at_epoch.completed.filter((id) => id !== 'P0P');
  candidate.node_states_at_epoch.blocked.push('P0P');
});
assert.equal(incompleteReadyPredecessor.status, 1, 'ready node with an incomplete hard predecessor must deny');
assert.ok(incompleteReadyPredecessor.receipt.error_codes.includes('READY_HARD_PREDECESSOR_INCOMPLETE'));
console.log('PASS ready node with incomplete hard predecessor denied');

const completedEvidenceReentered = runMutation('completed-evidence-reentered', (candidate) => {
  moveState(candidate, 'P1', 'completed', 'active_worker');
});
assert.equal(completedEvidenceReentered.status, 1, 'P1/P2 completed evidence must not re-enter ready work');
assert.ok(completedEvidenceReentered.receipt.error_codes.includes('COMPLETED_EVIDENCE_REENTERED_READY'));
console.log('PASS P1/P2 re-entry denied');

const moneyPathLimit = runMutation('money-path-limit', (candidate) => {
  moveState(candidate, 'I7', 'parked', 'active_worker');
  candidate.nodes.find((node) => node.id === 'I7').wip_class = 'money_path_implementation';
});
assert.equal(moneyPathLimit.status, 1, 'two ready money-path implementations must deny');
assert.ok(moneyPathLimit.receipt.error_codes.includes('ACTIVE_LANE_LIMIT_EXCEEDED'));
console.log('PASS money-path implementation lane limit enforced');

const gradeLimit = runMutation('independent-grade-limit', (candidate) => {
  moveState(candidate, 'I7', 'parked', 'active_worker');
  moveState(candidate, 'I8', 'parked', 'active_worker');
  candidate.nodes.find((node) => node.id === 'I7').wip_class = 'independent_grade';
  candidate.nodes.find((node) => node.id === 'I8').wip_class = 'independent_grade';
});
assert.equal(gradeLimit.status, 1, 'two ready independent grades must deny');
assert.ok(gradeLimit.receipt.error_codes.includes('ACTIVE_LANE_LIMIT_EXCEEDED'));
console.log('PASS independent-grade lane limit enforced');

const artifactPinMismatch = runMutation('artifact-pin-mismatch', (candidate) => {
  candidate.artifact_pins.find((pin) => pin.path === 'docs/designs/P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md').git_blob_oid = '0000000000000000000000000000000000000000';
});
assert.equal(artifactPinMismatch.status, 1, 'forged artifact pin must deny');
assert.ok(artifactPinMismatch.receipt.error_codes.includes('ARTIFACT_PIN_MISMATCH'));
console.log('PASS forged artifact pin denied');

const removedRequiredPin = runMutation('removed-required-pin', (candidate) => {
  candidate.artifact_pins = candidate.artifact_pins.filter((pin) => pin.path !== 'docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json');
});
assert.equal(removedRequiredPin.status, 1, 'removing a required evidence pin must deny');
assert.ok(removedRequiredPin.receipt.error_codes.includes('REQUIRED_ARTIFACT_PIN_MISSING'));

const staleJoin = runMutation('stale-join', (candidate) => {
  candidate.authority.status_join_commit = '0000000000000000000000000000000000000000';
});
assert.equal(staleJoin.status, 1, 'a stale join commit must deny');
assert.ok(staleJoin.receipt.error_codes.includes('EPOCH_JOIN_MISMATCH'));

const staleReportCommit = runMutation('stale-report-commit', (candidate) => {
  candidate.authority.status_epoch_report_commit = '0000000000000000000000000000000000000000';
});
assert.equal(staleReportCommit.status, 1, 'a stale report commit must deny');
assert.ok(staleReportCommit.receipt.error_codes.includes('EPOCH_REPORT_MISMATCH'));

const staleRulingCommit = runMutation('stale-ruling-commit', (candidate) => {
  candidate.authority.status_epoch_ruling_commit = '0000000000000000000000000000000000000000';
});
assert.equal(staleRulingCommit.status, 1, 'a stale ruling commit must deny');
assert.ok(staleRulingCommit.receipt.error_codes.includes('EPOCH_RULING_MISMATCH'));

const authorityPinMismatch = runMutation('authority-pin-mismatch', (candidate) => {
  candidate.authority.requirements_source_git_blob_oid = '0000000000000000000000000000000000000000';
});
assert.equal(authorityPinMismatch.status, 1, 'a changed blueprint authority pin must deny');
assert.ok(authorityPinMismatch.receipt.error_codes.includes('AUTHORITY_PIN_MISMATCH'));

const phaseExitMismatch = runMutation('phase-exit-mismatch', (candidate) => {
  candidate.objective.phase_1_exit = 'one compiler test passed';
});
assert.equal(phaseExitMismatch.status, 1, 'a weakened Phase-1 exit must deny');
assert.ok(phaseExitMismatch.receipt.error_codes.includes('PHASE_EXIT_MISMATCH'));

const unknownStateBucket = runMutation('unknown-state-bucket', (candidate) => {
  candidate.node_states_at_epoch.unclassified = [];
});
assert.equal(unknownStateBucket.status, 1, 'an unknown state bucket must fail closed');
assert.ok(unknownStateBucket.receipt.error_codes.includes('UNCLASSIFIED_NODE_STATE'));

const missingEpoch = runMutation('missing-epoch', (candidate) => {
  delete candidate.authority.status_epoch_report_commit;
});
assert.equal(missingEpoch.status, 1, 'a state snapshot without its epoch must deny');
assert.ok(missingEpoch.receipt.error_codes.includes('EPOCH_FIELD_MISSING'));

const completedMutationEdgeWithoutContract = runMutation('completed-mutation-edge-without-contract', (candidate) => {
  moveState(candidate, 'P0PC', 'active_worker', 'completed');
});
assert.equal(completedMutationEdgeWithoutContract.status, 1, 'a completed mutation edge without its compiler and ownership artifacts must deny');
assert.ok(completedMutationEdgeWithoutContract.receipt.error_codes.includes('MUTATION_EDGE_CONTRACT_MISSING'));

console.log('PASS epoch, authority, residual, phase-exit, and mutation-contract guards deny');
