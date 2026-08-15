#!/usr/bin/env node

import fs from 'node:fs';
import { evaluateHookEvent } from './claude-hook-bridge.mjs';

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

function visible(result) {
  const copy = { ...result };
  delete copy._audit;
  return copy;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function emit(obj) {
  if (obj && Object.keys(obj).length > 0) process.stdout.write(`${JSON.stringify(obj)}\n`);
}

let input = null;
try {
  const raw = fs.readFileSync(0, 'utf8');
  input = JSON.parse(raw);
  const manifestPath = arg('--manifest');
  if (!manifestPath) throw new Error('--manifest is required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  emit(visible(evaluateHookEvent({ input, manifest })));
} catch (error) {
  const reason = `GPT worker guard internal error: ${error.message}`;
  if (input?.hook_event_name === 'PreToolUse') emit(deny(reason));
  else if (input?.hook_event_name === 'TaskCompleted') emit(block(reason));
  else if (input?.hook_event_name === 'SessionStart') {
    emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${reason}. Guard was not armed; do not edit.` } });
  } else {
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
}
