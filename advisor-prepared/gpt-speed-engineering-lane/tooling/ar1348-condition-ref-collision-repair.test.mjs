// AR-1348 repair — a condition_ref like "entry_sequence[0].rationale" is a GENERIC taxonomy
// label (AR-1234's batch_locator format), not unique to any one frozen queue. A dispatch about a
// completely different video can carry the identical literal substring by pure vocabulary
// coincidence, and the pre-repair isG2Shaped() treated that bare label match as sufficient to
// deny — a false positive on every future video sharing the same taxonomy, first measured in
// AR-1348 (worker-1, 2026-08-19) blocking an AR-1345A dispatch for video E8Wg6tFPYjo.
//
// EVERY artifact here is synthetic. No control touches the real frozen sVkm queue, the real
// receipt directory, or the real pinned transcript fixture.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { loadG2Context, isG2Shaped } from './g2-precall-guard.mjs';

const REF = 'entry_sequence[0].rationale';
const TASK_SHA = 'a'.repeat(64);

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Builds a synthetic frozen queue + (optionally) a synthetic native-call manifest naming a
 *  synthetic pinned transcript, exactly mirroring the real repo's own file relationships
 *  (queue -> native_call_manifest.prompt_provenance.{transcript_path,transcript_sha256} ->
 *  transcript file on disk), all inside a throwaway tmp dir. */
function makeRig({ withTranscriptProvenance = true, corruptPinnedHash = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar1348-'));
  const receiptDir = path.join(root, 'isolated-receipts-t1');
  fs.mkdirSync(receiptDir, { recursive: true });

  const queuePath = path.join(root, 'isolated_fallback_queue_t1.json');
  fs.writeFileSync(queuePath, JSON.stringify({
    law_version: 'isolated-fallback-law-v1',
    max_attempts_per_condition: 1,
    queue: [{ condition_ref: REF, task_input_sha256: TASK_SHA }],
    attempts: {},
  }, null, 2));

  const transcriptText = 'FROZEN SVKM TRANSCRIPT CONTENT — the real closed packet source text.';
  const transcriptFsPath = path.join(root, 'pinned-transcript.txt');
  fs.writeFileSync(transcriptFsPath, transcriptText);

  let nativeCallManifestPath = null;
  if (withTranscriptProvenance) {
    nativeCallManifestPath = path.join(root, 'native_call_manifest_t1.json');
    fs.writeFileSync(nativeCallManifestPath, JSON.stringify({
      schema: 'g2d-native-call-identity-v1',
      prompt_provenance: {
        transcript_path: transcriptFsPath,
        transcript_sha256: corruptPinnedHash ? 'f'.repeat(64) : sha256(transcriptText),
      },
      calls: [],
    }, null, 2));
  }

  const g2 = loadG2Context({
    queuePath,
    receiptDir,
    repoRoot: root,
    nativeCallManifestPath,
  });

  return { root, queuePath, receiptDir, g2, transcriptText };
}

test('AR-1348 RED->GREEN: a different-video dispatch sharing the SAME condition_ref label, without the frozen transcript, is now benign', () => {
  const rig = makeRig();
  assert.equal(rig.g2.pinnedTranscript?.verified, true, 'precondition: transcript must independently verify');

  const differentVideoInput = {
    description: 'Stage-1 blind role-taxonomy adjudication, pilot video E8Wg6tFPYjo',
    // Same generic taxonomy label as the frozen queue's own condition_ref — the actual
    // collision — but a COMPLETELY DIFFERENT transcript underneath it.
    prompt: `CONDITION:\n${REF}\n\nTRANSCRIPT:\nSome other video's completely different source text.\n\nReturn the literal grounding quote, or null.`,
    subagent_type: 'general-purpose',
    model: 'opus',
  };

  const result = isG2Shaped(rig.g2, differentVideoInput);
  assert.equal(result.g2, false, `expected benign, got: ${JSON.stringify(result)}`);
});

test('AR-1348 NEGATIVE CONTROL: a dispatch that DOES carry the real pinned transcript is still denied', () => {
  const rig = makeRig();
  const realReopenAttempt = {
    description: 'test',
    prompt: `CONDITION:\n${REF}\n\nTRANSCRIPT:\n${rig.transcriptText}\n\nReturn the literal grounding quote, or null.`,
    subagent_type: 'general-purpose',
    model: 'opus',
  };
  const result = isG2Shaped(rig.g2, realReopenAttempt);
  assert.equal(result.g2, true, 'a call carrying the real frozen transcript must still be G2-shaped');
  assert.match(result.why, /pinned transcript content/);
});

test('AR-1348 FAIL-CLOSED DEFAULT: with no verifiable pinned transcript, bare label match still denies (pre-repair behavior unchanged)', () => {
  const rig = makeRig({ withTranscriptProvenance: false });
  assert.equal(rig.g2.pinnedTranscript, null, 'precondition: no transcript should be loaded');

  const differentVideoInput = {
    description: 'test',
    prompt: `CONDITION:\n${REF}\n\nTRANSCRIPT:\nunrelated content\n\nReturn the literal grounding quote, or null.`,
    subagent_type: 'general-purpose',
    model: 'opus',
  };
  const result = isG2Shaped(rig.g2, differentVideoInput);
  assert.equal(result.g2, true, 'without independent verification the guard must stay fail-closed, exactly as before this repair');
});

test('AR-1348 FAIL-CLOSED ON CORRUPTION: a pinned transcript whose live file no longer matches its own recorded hash is never trusted', () => {
  const rig = makeRig({ corruptPinnedHash: true });
  assert.equal(rig.g2.pinnedTranscript, null, 'a hash mismatch must leave pinnedTranscript unverified, not partially trusted');

  const differentVideoInput = {
    description: 'test',
    prompt: `CONDITION:\n${REF}\n\nTRANSCRIPT:\nunrelated content\n\nReturn the literal grounding quote, or null.`,
    subagent_type: 'general-purpose',
    model: 'opus',
  };
  const result = isG2Shaped(rig.g2, differentVideoInput);
  assert.equal(result.g2, true, 'a corrupted/mismatched pinned transcript must fall back to fail-closed, never to benign');
});

test('AR-1348 UNCHANGED: queue-path and receipt-dir references still deny regardless of the transcript check', () => {
  const rig = makeRig();
  const referencesQueueFile = {
    description: 'test',
    prompt: `please read isolated_fallback_queue_t1.json and answer`,
    subagent_type: 'general-purpose',
    model: 'opus',
  };
  const result = isG2Shaped(rig.g2, referencesQueueFile);
  assert.equal(result.g2, true);
  assert.match(result.why, /frozen queue artifact/);
});

test('AR-1348 UNCHANGED: a call naming none of the frozen surface (no label, no queue/receipt reference) is benign, as before', () => {
  const rig = makeRig();
  const ordinary = {
    description: 'ordinary unrelated work',
    prompt: 'summarize this file',
    subagent_type: 'general-purpose',
    model: 'opus',
  };
  const result = isG2Shaped(rig.g2, ordinary);
  assert.equal(result.g2, false);
});
