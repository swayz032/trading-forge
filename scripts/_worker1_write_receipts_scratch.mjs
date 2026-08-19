import fs from 'node:fs';
import path from 'node:path';

const BASE = 'docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs';

const videos = ['1HFoStW_wsc', 'E8Wg6tFPYjo', 'FAKWJ-1NlLE', 'FqxEKDxemtI', '7ieYBa7Z-Hg'];

for (const video_id of videos) {
  const indexPath = path.join(BASE, video_id, 'task_index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const receipt = {
    video_id,
    task_sha256: index.task_sha256,
    transcript_sha256: index.transcript_sha256,
    model_override: 'opus',
    actual_model_identity: 'override=opus; exact runtime model identity not independently surfaced to the dispatcher (Agent tool model override accepted, no separate attestation channel available)',
    subagent_type: 'general-purpose',
    reader_role: 'OPUS_LEAD_SOURCE_READER',
    fresh_reader: true,
    prompt_source: 'task_file_only',
    legacy_semantics_visible: false,
    invocation_notes: 'ONE fresh Opus reader; given only the emitted task text (preamble + video id + transcript) as the Agent tool prompt, verbatim as read from opus_source_reader_task.txt. No legacy extraction JSON, no prior certificate/adjudication text, no legacy strategy count, was included in the dispatch.'
  };
  const outPath = path.join(BASE, video_id, 'invocation_receipt.json');
  fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log('wrote', outPath);
}
