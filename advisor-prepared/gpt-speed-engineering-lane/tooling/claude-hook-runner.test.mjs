import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'claude-hook-runner.mjs');

function run(input, manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hook-runner-'));
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const stdout = execFileSync(process.execPath, [runner, '--manifest', manifestPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

const invalidManifest = { schema: 'wrong', worker: 'worker-1' };

test('invalid manifest denies PreToolUse instead of failing open', () => {
  const result = run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'x' } }, invalidManifest);
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /internal error/);
});

test('invalid manifest blocks TaskCompleted instead of accepting fake completion', () => {
  const result = run({ hook_event_name: 'TaskCompleted' }, invalidManifest);
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /internal error/);
});

test('invalid manifest warns SessionStart and does not claim guard is armed', () => {
  const result = run({ hook_event_name: 'SessionStart', source: 'startup' }, invalidManifest);
  assert.match(result.hookSpecificOutput.additionalContext, /Guard was not armed; do not edit/);
});
