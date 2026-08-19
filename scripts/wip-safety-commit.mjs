#!/usr/bin/env node
/**
 * WIP SAFETY-COMMIT — Stop hook (fires "right before Claude concludes its response").
 *
 * WHY THIS EXISTS
 *   Twice now (AR-1334A, and again 2026-08-18 on AR-1155/AR-1335A) a worker session ended without
 *   committing, leaving tracked files dirty. The next SessionStart's resume-anchor-guard correctly
 *   refused to arm ("worktree is dirty at an ungoverned path") and the seat was hand-unblocked by
 *   committing the orphaned WIP. This hook makes that unblock automatic instead of recurring: after
 *   EVERY turn, if the tracked working tree is dirty, it commits a checkpoint. Because Stop fires on
 *   every turn (not just a graceful session close), this survives abrupt session death — a crash,
 *   a closed window, a seat roll — not only a clean exit. A future SessionStart can then never
 *   inherit more than one turn's worth of uncommitted drift.
 *
 * WHY THIS IS NOT A SECOND GUARD
 *   It makes no permission or authorization decision and never blocks anything. It only decides
 *   WHAT to preserve (dirty tracked files, minus the self-protected exclusion list below) and does
 *   so with a plain `git commit`, which is a normal, reversible, inspectable git operation — not a
 *   change to the pinned toolbox's boundary law. The resume-anchor-guard and lane-boundary-guard
 *   still run exactly as before and still decide what a *future* session may edit.
 *
 * SELF-PROTECTION
 *   Guard/config surfaces (the hook manifest, .claude/settings*.json, the pinned-toolbox doorway
 *   files) are deliberately EXCLUDED from the auto-commit, same reasoning as AR-1263 SS7A: those
 *   need a deliberate, reviewed commit, not a silent bot checkpoint. If one of them is dirty, this
 *   script leaves it dirty (a future SessionStart will correctly keep blocking on it) and only
 *   reports that fact to stderr.
 *
 * FAIL-OPEN, ON PURPOSE (opposite of claude_guard_hook.mjs)
 *   This is a Stop hook, not a PreToolUse/SessionStart guard: it never gates a tool call or a
 *   session boot. Every failure path here logs to stderr and exits 0. A safety net that can itself
 *   block a turn (via exit code 2) would be worse than no safety net.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SELF_PROTECTED = [
  /^\.claude\/[^/]*hook-guard-manifest\.json$/,
  /^\.claude\/settings.*\.json$/,
  /^\.claude\/hooks\//,
  /^scripts\/claude_guard_hook\.mjs$/,
  /^scripts\/claude_toolbox\.mjs$/,
  /^scripts\/wip-safety-commit\.mjs$/,
];

function isSelfProtected(repoPath) {
  return SELF_PROTECTED.some((re) => re.test(repoPath));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  // Consume stdin (the Stop hook payload) without needing any field from it.
  try { fs.readFileSync(0, 'utf8'); } catch { /* no stdin is fine */ }

  const startCwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let repoRoot;
  try {
    repoRoot = git(startCwd, ['rev-parse', '--show-toplevel']).trim();
  } catch (error) {
    process.stderr.write(`wip-safety-commit: not a git worktree, skipping (${error.message})\n`);
    return;
  }

  let statusRaw;
  try {
    statusRaw = git(repoRoot, ['status', '--porcelain', '-z']);
  } catch (error) {
    process.stderr.write(`wip-safety-commit: git status failed, skipping: ${error.message}\n`);
    return;
  }

  const parts = statusRaw.split('\0');
  const toCommit = [];
  const skippedProtected = [];
  const skippedUntracked = [];

  for (let i = 0; i < parts.length; i += 1) {
    const record = parts[i];
    if (!record) continue;
    const x = record[0];
    const y = record[1];
    if (x === 'R' || x === 'C') i += 1; // rename/copy origin path follows, in the next NUL field
    const repoPath = record.slice(3).replaceAll('\\', '/');
    if (x === '?' && y === '?') {
      skippedUntracked.push(repoPath);
      continue;
    }
    if (isSelfProtected(repoPath)) {
      skippedProtected.push(repoPath);
      continue;
    }
    toCommit.push(repoPath);
  }

  if (skippedProtected.length > 0) {
    process.stderr.write(
      `wip-safety-commit: leaving self-protected paths dirty on purpose (need a reviewed commit): ${skippedProtected.join(', ')}\n`,
    );
  }
  if (skippedUntracked.length > 0) {
    process.stderr.write(
      `wip-safety-commit: leaving untracked paths alone (not auto-added, could be scratch/junk): ${skippedUntracked.join(', ')}\n`,
    );
  }

  if (toCommit.length === 0) return;

  try {
    git(repoRoot, ['add', '--', ...toCommit]);
    const branch = git(repoRoot, ['branch', '--show-current']).trim() || '(detached)';
    const stamp = new Date().toISOString();
    const message = [
      `auto-wip: turn-end safety commit (unreviewed) — ${branch} — ${stamp}`,
      '',
      `Auto-committed by scripts/wip-safety-commit.mjs (Stop hook) so a future SessionStart never`,
      `blocks on dirty state inherited from an interrupted session. This commit has NOT been`,
      `reviewed or tested — the resuming worker must inspect it before treating it as final.`,
      '',
      `Files: ${toCommit.join(', ')}`,
    ].join('\n');
    git(repoRoot, ['commit', '-m', message]);
  } catch (error) {
    process.stderr.write(`wip-safety-commit: commit failed, leaving tree as-is: ${error.message}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`wip-safety-commit: unexpected error, ignoring: ${error.message}\n`);
}
