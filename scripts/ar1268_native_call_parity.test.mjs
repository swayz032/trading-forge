// AR-1268 §C — CROSS-LANGUAGE PARITY FOR THE FROZEN NATIVE-CALL IDENTITY.
//
// THE JOIN THIS CHECKS, AND WHY IT IS THE RISKY ONE
//   The expected hash is written by PYTHON (`scripts/g2d_freeze_native_calls.py`) and compared by
//   JAVASCRIPT (`g2-precall-guard.mjs::canonicalNativeCallSha256`) inside the pinned toolbox. Two
//   canonicalisers in two languages that agree today can drift apart on separator whitespace, key
//   order, or unicode escaping — and the failure mode is silent: every legitimate call would DENY
//   and the obvious "fix" would be to loosen the guard.
//
//   So this asserts the join directly, against the REAL frozen artifact, using the ACTUAL pinned
//   guard resolved through the activator — not a copy of either side.
//
// IT SPENDS NOTHING
//   Read-only. It regenerates prompts from frozen inputs and hashes them. No permit is written,
//   no receipt is created, no attempt is claimed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { materialize } from './claude_toolbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const MANIFEST_PATH = path.join(
  REPO, 'docs', 'replay-results', 'svkm-extraction-certified', 'grade', 'opus-v2',
  'native_call_manifest_t1.json',
);
const PYTHON = process.env.TF_PYTHON || 'python';

const receipt = materialize();
const guard = await import(pathToFileURL(path.join(receipt.cache, 'g2-precall-guard.mjs')).href);
const frozen = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

function emitPrompt(ref) {
  const res = spawnSync(PYTHON, [
    path.join(HERE, 'g2d_freeze_native_calls.py'), '--emit-prompt', ref,
  ], { encoding: 'utf8', cwd: REPO, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

test('the artifact loads under the pinned guard\'s own schema check', () => {
  const loaded = guard.loadNativeCallManifest({ manifestPath: MANIFEST_PATH });
  assert.equal(loaded.rows.size, 8);
  assert.equal(loaded.queueArtifactSha256, frozen.queue_artifact_sha256);
});

test('the frozen queue sha in the artifact is the LIVE queue sha (not a stale copy)', () => {
  const live = guard.sha256File(path.join(REPO, frozen.queue_artifact_path));
  assert.equal(frozen.queue_artifact_sha256, live);
});

for (const row of frozen.calls) {
  test(`PARITY ${row.condition_ref}: python-frozen hash == the pinned JS canonicaliser`, () => {
    const prompt = emitPrompt(row.condition_ref);
    assert.equal(
      guard.canonicalNativeCallSha256({
        model: row.model,
        subagent_type: row.subagent_type,
        prompt,
      }),
      row.native_call_sha256,
      'the two canonicalisers disagree — a legitimate call would be denied and the guard would look wrong',
    );
  });
}

test('DISCRIMINATES: one changed byte in the prompt breaks the parity match', () => {
  // Without this, agreement above could be an artefact of both sides hashing the same constant.
  const row = frozen.calls[0];
  const prompt = `${emitPrompt(row.condition_ref)} `;
  assert.notEqual(
    guard.canonicalNativeCallSha256({ model: row.model, subagent_type: row.subagent_type, prompt }),
    row.native_call_sha256,
  );
});

test('DISCRIMINATES: the model field is inside the hash, not beside it', () => {
  const row = frozen.calls[0];
  const prompt = emitPrompt(row.condition_ref);
  assert.notEqual(
    guard.canonicalNativeCallSha256({ model: 'sonnet', subagent_type: row.subagent_type, prompt }),
    row.native_call_sha256,
  );
});

test('every frozen row requests opus through general-purpose, never fork', () => {
  for (const row of frozen.calls) {
    assert.equal(row.model, 'opus');
    assert.notEqual(row.subagent_type, 'fork');
  }
});
