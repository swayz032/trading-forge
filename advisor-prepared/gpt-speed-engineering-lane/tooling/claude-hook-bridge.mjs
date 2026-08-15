#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyResumeAnchor } from './resume-anchor-guard.mjs';
import { auditPaths } from './lane-boundary-guard.mjs';
import { evaluateScope } from './edit-scope-guard.mjs';
import { runClaudeFinishCheck } from './claude-finish-check.mjs';

const GUARDED_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function block(reason) {
  return { decision: 'block', reason };
}

function getRepoRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

function normalizeToolPath(repoRoot, cwd, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new Error('tool path must be a non-empty string');
  }
  const absolute = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(cwd, rawPath);
  const root = path.resolve(repoRoot);
  const rel = path.relative(root, absolute).replaceAll('\\', '/');
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    throw new Error(`tool path escapes repository root: ${rawPath}`);
  }
  return rel;
}

function extractEditPaths(input, repoRoot) {
  const toolInput = input.tool_input || {};
  const candidates = [toolInput.file_path, toolInput.notebook_path].filter((x) => typeof x === 'string' && x.trim() !== '');
  if (candidates.length === 0) throw new Error(`cannot prove target path for ${input.tool_name}`);
  return [...new Set(candidates.map((p) => normalizeToolPath(repoRoot, input.cwd || repoRoot, p)))];
}

function bashMutationReason(command) {
  if (typeof command !== 'string' || command.trim() === '') return 'Bash command is missing';
  const c = command.trim();
  const dangerousGit = /\bgit\s+(checkout|switch|reset|clean|rebase|merge|cherry-pick)\b|\bgit\s+push\b[^\n;&|]*--force(?:-with-lease)?\b|\bgit\s+branch\s+-[dD]\b/i;
  if (dangerousGit.test(c)) return 'branch/worktree/history mutation is blocked inside guarded worker sessions';

  const directMutator = /(^|[;&|]\s*|\s)(sed\s+-i\b|perl\s+-[^\s]*i[^\s]*\b|tee\b|touch\b|rm\b|mv\b|cp\b|truncate\b|install\b|patch\b|apply_patch\b)/i;
  if (directMutator.test(c)) return 'direct file mutation through Bash is blocked; use Edit/Write so lane and scope guards can inspect the target path';

  const redirect = /(^|[^<])(?:>>|>)(?![>&])/;
  if (redirect.test(c)) return 'file-output redirection through Bash is blocked in guarded worker sessions; use an inspected write path instead';

  const scriptedWrite = /\b(writeFileSync|writeFile|appendFileSync|appendFile|write_text|write_bytes)\b|\bopen\s*\([^\n]*,[^\n]*['\"](?:w|a|x)[+b]?['\"]/i;
  if (scriptedWrite.test(c)) return 'scripted file mutation through Bash is blocked; use Edit/Write so the authorized path can be checked';

  return null;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest must be an object');
  if (manifest.schema !== 'gpt-claude-hook-guard-v1') throw new Error('unsupported or missing manifest schema');
  if (!['worker-1', 'worker-2'].includes(manifest.worker)) throw new Error('manifest.worker must be worker-1 or worker-2');
  if (!manifest.session_anchor || typeof manifest.session_anchor !== 'object') throw new Error('manifest.session_anchor is required');
  if (!manifest.edit_scope || typeof manifest.edit_scope !== 'object') throw new Error('manifest.edit_scope is required');
  const allowedExact = manifest.edit_scope.allowed_exact || [];
  const allowedPrefixes = manifest.edit_scope.allowed_prefixes || [];
  evaluateScope({ changedPaths: [], allowedExact, allowedPrefixes });
  return manifest;
}

function sessionContext(anchor) {
  if (anchor.ok) {
    return `GPT worker guard: anchor verified on ${anchor.branch} at ${anchor.head}. Native edits remain subject to lane + authorized-scope enforcement.`;
  }
  return `GPT worker guard STOP: ${anchor.errors.join('; ')}. Do not edit. Resolve the exact worker branch/resume anchor first.`;
}

function persistAnchorOk(envFile) {
  if (!envFile) return;
  fs.appendFileSync(envFile, 'export TF_CLAUDE_GUARD_ANCHOR_OK=1\n');
}

function loadReceipt(repoRoot, receiptFile) {
  if (typeof receiptFile !== 'string' || receiptFile.trim() === '') throw new Error('finish.receipt_file is required');
  const absolute = path.isAbsolute(receiptFile) ? receiptFile : path.resolve(repoRoot, receiptFile);
  const rel = path.relative(repoRoot, absolute);
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) throw new Error('finish.receipt_file escapes repository root');
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

export function evaluateHookEvent({ input, manifest, env = process.env }) {
  validateManifest(manifest);
  if (!input || typeof input !== 'object') throw new Error('hook input must be an object');
  const cwd = input.cwd || process.cwd();
  const repoRoot = getRepoRoot(cwd);
  const event = input.hook_event_name;

  if (event === 'SessionStart') {
    const anchor = verifyResumeAnchor({
      cwd: repoRoot,
      expectedBranch: manifest.session_anchor.expected_branch,
      expectedHead: manifest.session_anchor.expected_head,
      requireClean: manifest.session_anchor.require_clean !== false,
    });
    if (anchor.ok) persistAnchorOk(env.CLAUDE_ENV_FILE);
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: sessionContext(anchor),
      },
      _audit: { event, anchor },
    };
  }

  if (event === 'PreToolUse') {
    if (env.TF_CLAUDE_GUARD_ANCHOR_OK !== '1') {
      return { ...deny('worker session anchor was not verified at SessionStart; edits are fail-closed'), _audit: { event, anchor_verified: false } };
    }

    if (input.tool_name === 'Bash') {
      const reason = bashMutationReason(input.tool_input?.command);
      return reason
        ? { ...deny(reason), _audit: { event, bash_mutation_blocked: true } }
        : { _audit: { event, bash_mutation_blocked: false } };
    }

    if (!GUARDED_EDIT_TOOLS.has(input.tool_name)) return { _audit: { event, guarded: false } };

    let paths;
    try {
      paths = extractEditPaths(input, repoRoot);
    } catch (error) {
      return { ...deny(error.message), _audit: { event, path_error: error.message } };
    }

    const lane = auditPaths(manifest.worker, paths);
    const scope = evaluateScope({
      changedPaths: paths,
      allowedExact: manifest.edit_scope.allowed_exact || [],
      allowedPrefixes: manifest.edit_scope.allowed_prefixes || [],
    });
    if (!lane.safe_to_edit_without_handoff) {
      return { ...deny(`lane guard rejected ${paths.join(', ')}: ${lane.results.map((r) => `${r.verdict}:${r.reason}`).join(' | ')}`), _audit: { event, paths, lane, scope } };
    }
    if (!scope.ok) {
      return { ...deny(`authorized edit scope rejected: ${scope.out_of_scope.join(', ')}`), _audit: { event, paths, lane, scope } };
    }
    return { _audit: { event, paths, lane, scope } };
  }

  if (event === 'TaskCompleted') {
    if (env.TF_CLAUDE_GUARD_ANCHOR_OK !== '1') {
      return { ...block('worker session anchor was never verified; task completion is blocked'), _audit: { event, anchor_verified: false } };
    }
    if (!manifest.finish || manifest.finish.enabled !== true) {
      return { ...block('finish verification is not armed for this packet; task completion is fail-closed'), _audit: { event, finish_armed: false } };
    }
    try {
      const receipt = loadReceipt(repoRoot, manifest.finish.receipt_file);
      const result = runClaudeFinishCheck({
        cwd: repoRoot,
        worker: manifest.worker,
        base: manifest.finish.base,
        head: manifest.finish.head || 'HEAD',
        scope: manifest.edit_scope,
        receipt,
        otherWorkerRef: manifest.finish.other_worker_ref || null,
        collisionBase: manifest.finish.collision_base || null,
      });
      if (!result.ok) return { ...block(`mechanical finish check failed: ${result.failures.join('; ')}`), _audit: { event, finish: result } };
      return { _audit: { event, finish: result } };
    } catch (error) {
      return { ...block(`finish verification error: ${error.message}`), _audit: { event, finish_error: error.message } };
    }
  }

  return { _audit: { event, guarded: false } };
}

function visibleHookOutput(result) {
  const copy = { ...result };
  delete copy._audit;
  return copy;
}

function parseArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  try {
    const manifestPath = parseArg('--manifest');
    if (!manifestPath) throw new Error('--manifest is required');
    const inputText = fs.readFileSync(0, 'utf8');
    const input = JSON.parse(inputText);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const result = evaluateHookEvent({ input, manifest });
    const visible = visibleHookOutput(result);
    if (Object.keys(visible).length > 0) process.stdout.write(`${JSON.stringify(visible)}\n`);
  } catch (error) {
    const event = (() => {
      try { return JSON.parse(fs.readFileSync(0, 'utf8')).hook_event_name; } catch { return null; }
    })();
    if (event === 'PreToolUse') process.stdout.write(`${JSON.stringify(deny(`GPT worker guard internal error: ${error.message}`))}\n`);
    else if (event === 'TaskCompleted') process.stdout.write(`${JSON.stringify(block(`GPT worker guard internal error: ${error.message}`))}\n`);
    else process.stderr.write(`claude-hook-bridge: ${error.message}\n`);
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
