#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function runGit(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) throw new Error('files_changed must be an array');
  return [...new Set(files.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') throw new Error('files_changed entries must be non-empty strings');
    const normalized = item.trim().replaceAll('\\', '/').replace(/^\.\//, '');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error(`unsafe changed path: ${item}`);
    return normalized;
  }))].sort();
}

function resolveBranchRef(repo, branch) {
  const refs = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`];
  for (const ref of refs) {
    try {
      runGit(repo, ['rev-parse', '--verify', ref]);
      return ref;
    } catch {
      // try next ref
    }
  }
  return null;
}

export function verifyReceipt(receipt, repo = '.') {
  const failures = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('receipt must be a JSON object');
  }

  const commit = typeof receipt.commit === 'string' ? receipt.commit.trim() : '';
  const branch = typeof receipt.branch === 'string' ? receipt.branch.trim() : '';
  if (!commit) failures.push('missing commit');
  if (!branch) failures.push('missing branch');
  if (receipt.pushed !== true) failures.push('receipt does not assert pushed=true');
  if (receipt.stopped_for_gpt !== true) failures.push('receipt does not assert stopped_for_gpt=true');

  let claimedFiles = [];
  try {
    claimedFiles = normalizeFiles(receipt.files_changed);
  } catch (error) {
    failures.push(error.message);
  }
  if (claimedFiles.length === 0) failures.push('files_changed is empty');

  let actualFiles = [];
  let commitExists = false;
  if (commit) {
    try {
      runGit(repo, ['cat-file', '-e', `${commit}^{commit}`]);
      commitExists = true;
      const output = runGit(repo, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit]);
      actualFiles = output ? [...new Set(output.split(/\r?\n/).filter(Boolean))].sort() : [];
    } catch {
      failures.push(`commit is not available in repository: ${commit}`);
    }
  }

  if (commitExists && claimedFiles.length > 0) {
    const same = claimedFiles.length === actualFiles.length && claimedFiles.every((value, index) => value === actualFiles[index]);
    if (!same) failures.push('claimed files_changed does not exactly match commit diff');
  }

  let branchRef = null;
  let branchContainsCommit = false;
  if (branch) {
    branchRef = resolveBranchRef(repo, branch);
    if (!branchRef) {
      failures.push(`branch is not available in repository: ${branch}`);
    } else if (commitExists) {
      try {
        execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', commit, branchRef], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        branchContainsCommit = true;
      } catch {
        failures.push(`branch does not contain reported commit: ${branch}`);
      }
    }
  }

  return {
    schema: 'gpt-commit-evidence-verifier-v1',
    ok: failures.length === 0,
    commit,
    branch,
    branch_ref: branchRef,
    branch_contains_commit: branchContainsCommit,
    claimed_files: claimedFiles,
    actual_files: actualFiles,
    failures,
  };
}

function parseCli(argv) {
  let input = null;
  let repo = '.';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') input = argv[++i];
    else if (arg === '--repo') repo = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!input) throw new Error('--input receipt.json is required');
  return { input, repo };
}

function main() {
  try {
    const { input, repo } = parseCli(process.argv.slice(2));
    const receipt = JSON.parse(fs.readFileSync(input, 'utf8'));
    const result = verifyReceipt(receipt, repo);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`commit-evidence-verifier: ${error.message}\n`);
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
