#!/usr/bin/env node
/**
 * THE ONE TERMINAL FINALIZE PATH — AR-1278A F-14.
 *
 * 🛑 THE DEADLOCK THIS SOLVES. The seat manifest pins `head`, and every PreToolUse remeasures HEAD.
 * That is correct before edits — and fatal after the first commit, because HEAD advances and the
 * next tool call (including the push) fails its own identity check. The wrong fix is a mutable-HEAD
 * exception, which would blow a hole in the identity contract for the sake of convenience.
 *
 * The right fix is to make finalization TERMINAL: one helper does commit + push + completion
 * receipt as the last mutating act. Afterwards, further tool calls may legitimately deny because
 * HEAD moved — that is fine, because there is nothing left to do.
 *   `SOLVE THE LAST STEP BY ENDING, NOT BY WEAKENING EVERY STEP BEFORE IT.`
 *
 * WHAT IT REFUSES TO BE:
 *   - it STAGES NOTHING. Staging happens through `git add <path>`, which the guard classifies.
 *   - it takes NO arguments at all — no branch, no remote, no path, no executable. There is nothing
 *     for model text to choose.
 *   - it re-checks every STAGED path against the GPT allowlist and aborts on the first violation,
 *     so a path that slipped past staging cannot ride out in the commit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { classifyControlPlanePath } from './control-plane-guard.mjs';

const MSG_FILE = 'scripts/control-plane-bootstrap/.cp-commit-msg.tmp';
const MANIFEST_REL = '.claude/control-plane-guard-manifest.json';

function fail(msg) {
  console.error(`cp-finalize REFUSED: ${msg}`);
  process.exit(2);
}

if (process.argv.length > 2) fail('this helper takes no arguments');

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_REL), 'utf8'));
} catch (error) {
  fail(`cannot read ${MANIFEST_REL}: ${error.message}`);
}

// Identity, re-measured. A seat that is wrong about where it is does not get to publish.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== manifest.branch) fail(`on branch ${branch}, manifest authorizes ${manifest.branch}`);
const remote = git('config', '--get', 'remote.origin.url');
const repo = (remote.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/]+)$/) || [null, null])[1];
if (repo !== manifest.repo) fail(`origin is ${repo}, manifest authorizes ${manifest.repo}`);

// Every STAGED path must clear the same allowlist the guard applies to Edit/Write/git add.
const staged = git('diff', '--cached', '--name-only').split('\n').map((s) => s.trim()).filter(Boolean);
if (staged.length === 0) fail('nothing is staged');
const violations = staged
  .map((p) => classifyControlPlanePath(p, manifest.allowed_paths))
  .filter((v) => v.verdict !== 'ALLOW');
if (violations.length > 0) {
  fail(`staged paths outside the authorization: ${violations.map((v) => `${v.path} (${v.reason})`).join('; ')}`);
}

const msgPath = path.join(repoRoot, MSG_FILE);
if (!fs.existsSync(msgPath)) fail(`${MSG_FILE} does not exist`);

const gitDir = git('rev-parse', '--absolute-git-dir');
const scratch = path.join(gitDir, 'CP_FINALIZE_MSG');
let commitSha = null;
try {
  fs.writeFileSync(scratch, fs.readFileSync(msgPath, 'utf8'), 'utf8');
  fs.rmSync(msgPath, { force: true });
  execFileSync('git', ['-C', repoRoot, 'commit', '-F', scratch], { stdio: 'inherit' });
  commitSha = git('rev-parse', 'HEAD');
} catch (error) {
  fail(`commit failed: ${error.message}`);
} finally {
  fs.rmSync(scratch, { force: true });
}

let pushed = false;
let pushDetail = '';
try {
  // The branch is the MEASURED one, not an argument. There is no way to push somewhere else.
  execFileSync('git', ['-C', repoRoot, 'push', 'origin', branch], { stdio: 'inherit' });
  pushed = true;
} catch (error) {
  pushDetail = error.message;
}

// The completion receipt lives beside the armed receipt, in the git directory — outside the working
// tree, so the seat cannot forge it through Edit/Write/Bash. The supervising bootstrap reads this.
const receipt = {
  schema: 'CONTROL_PLANE_COMPLETION_RECEIPT_V1',
  actor: manifest.actor,
  repo: manifest.repo,
  branch,
  target_packet: manifest.target_packet,
  authorization_id: manifest.authorization_id,
  ruling_id: manifest.ruling_id,
  bootstrap_bundle_sha256: manifest.bootstrap_bundle_sha256,
  commit_sha: commitSha,
  changed_paths: staged,
  pushed,
  push_detail: pushDetail,
};
fs.writeFileSync(path.join(gitDir, 'tf-control-plane-completion.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

console.error(`cp-finalize: committed ${commitSha} on ${branch}, pushed=${pushed}, paths=${staged.length}`);
process.exit(pushed ? 0 : 1);
