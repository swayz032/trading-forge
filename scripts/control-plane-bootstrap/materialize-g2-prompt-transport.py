#!/usr/bin/env python3
"""AR-1291 §A / F-19 — THE ONE FIXED-CLI TRANSPORT FOR THE EIGHT FROZEN G2 PROMPTS.

WHY THIS EXISTS
    The privileged control-plane seat's Bash policy is default-deny: no shell redirection, no
    `python -c`, no arbitrary script execution (`control-plane-guard.mjs`). The canonical prompt
    emitter already exists and already reuses the frozen locator templates by import
    (`g2d_freeze_native_calls.py --emit-prompt <ref>`) — but it is unreachable from inside the seat,
    because it takes a caller-supplied `condition_ref` argument and writes to stdout, and neither
    shape is a fixed no-argument command the guard can allow. Manual reconstruction is forbidden:
    the frozen native-call hashes are byte-sensitive (see that script's own CRLF/LF lesson).

    This helper is the ONE fixed transport surface: no arguments, drives the canonical construction
    once for all eight frozen conditions, verifies every byte against the already-frozen
    `native_call_manifest_t1.json` before anything is written, and writes plain files to one
    non-authority directory.

WHAT THIS IS NOT
    Not a new prompt author, not a selector, not an authority. `_SYSTEM_PROMPT` and
    `_build_user_message` are used BY IMPORT from `g2d_freeze_native_calls.py`, which itself reuses
    them BY IMPORT from `anchor_locator.py` — no template is retyped at any hop. Every row is
    verified against the frozen manifest before its bytes touch disk; a mismatch refuses instead of
    writing something no ruling has seen.

Usage:
    python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py

No arguments are accepted. No output path, model, condition, or prompt may be supplied by a caller.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

## This file lives at scripts/control-plane-bootstrap/<this file>.py — TWO directories below the
## repo root, unlike scripts/g2d_freeze_native_calls.py which lives one directory below it. Three
## dirname() calls, not two: dirname(__file__) = .../scripts/control-plane-bootstrap,
## dirname(that) = .../scripts, dirname(that) = repo root.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import g2d_freeze_native_calls as native  # noqa: E402  (reused BY IMPORT — see module docstring)

OUT_DIR = os.path.join('docs', 'replay-results', 'g2d-prompt-transport')
INDEX_PATH = os.path.join(OUT_DIR, 'index.json')

# Everything this helper may ever read. Nothing outside this set, and nothing under it is ever
# written to — F-19 / E8: never write into the frozen queue/receipt/manifest namespaces.
READ_ONLY_INPUTS = (native.QUEUE_PATH, native.BENCHMARK_PATH, native.OUT_PATH)


def _abs(rel: str) -> str:
    return os.path.join(ROOT, rel)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_json(rel: str):
    path = native._abs(rel)
    if not os.path.exists(path):
        return None, f'missing: {rel}'
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh), None
    except (json.JSONDecodeError, OSError) as exc:
        return None, f'unreadable: {rel} ({exc})'


def _verified_rows():
    """Read-only. Returns (rows, error). rows is a list of {ref, prompt_bytes, native_call_sha256}
    only when EVERY frozen row independently verifies; otherwise returns (None, reason) and touches
    no output path at all."""
    manifest, err = _load_json(native.OUT_PATH)
    if err:
        return None, f'refused: {err}'

    # Re-derive from the frozen inputs. build() re-verifies the locator prompt/template/transcript
    # against the benchmark packet itself and raises on any drift — reused, not re-implemented.
    try:
        derived = native.build()
    except SystemExit as exc:
        return None, f'refused: fresh derivation did not verify: {exc}'

    manifest_rows = {row.get('condition_ref'): row for row in manifest.get('calls', [])} if isinstance(manifest, dict) else {}
    derived_rows = {row['condition_ref']: row for row in derived['calls']}
    if set(manifest_rows) != set(derived_rows):
        return None, 'refused: frozen manifest and a fresh derivation do not name the same condition set'

    queue, err = _load_json(native.QUEUE_PATH)
    if err:
        return None, f'refused: {err}'
    bench, err = _load_json(native.BENCHMARK_PATH)
    if err:
        return None, f'refused: {err}'
    transcript_rel = bench.get('input', {}).get('transcript_path')
    transcript_path = native._abs(transcript_rel) if transcript_rel else None
    if not transcript_path or not os.path.exists(transcript_path):
        return None, f'refused: missing transcript {transcript_rel}'
    with open(transcript_path, encoding='utf-8') as fh:
        transcript = fh.read()

    rows = []
    for entry in queue.get('queue', []):
        ref = entry.get('condition_ref')
        manifest_row = manifest_rows.get(ref)
        derived_row = derived_rows.get(ref)
        if manifest_row is None or derived_row is None:
            return None, f'refused: {ref} is not present in both the frozen manifest and a fresh derivation'

        # Reconstructed via the SAME canonical construction native.build() just re-verified —
        # not retyped, not a new template.
        user_message = native._build_user_message(transcript, entry['condition_text'])
        prompt_text = native._SYSTEM_PROMPT + native.PROMPT_JOINER + user_message
        prompt_bytes = prompt_text.encode('utf-8')

        checks = {
            'condition_ref_matches_manifest_row': ref in manifest_rows,
            'model_is_opus': manifest_row.get('model') == native.APPROVED_MODEL == derived_row.get('model'),
            'subagent_type_is_general_purpose': (
                manifest_row.get('subagent_type') == native.APPROVED_SUBAGENT_TYPE == derived_row.get('subagent_type')
            ),
            'task_input_sha256_unchanged': (
                manifest_row.get('task_input_sha256') == derived_row.get('task_input_sha256') == entry.get('task_input_sha256')
            ),
            'native_prompt_sha256_matches': (
                manifest_row.get('native_prompt_sha256') == derived_row.get('native_prompt_sha256') == _sha(prompt_bytes)
            ),
            'native_prompt_char_count_matches': (
                manifest_row.get('native_prompt_char_count') == derived_row.get('native_prompt_char_count') == len(prompt_text)
            ),
            'native_call_sha256_rederives': manifest_row.get('native_call_sha256') == derived_row.get('native_call_sha256'),
        }
        failed = [k for k, ok in checks.items() if not ok]
        if failed:
            return None, f'refused: {ref} failed verification: {", ".join(failed)}'

        rows.append({'ref': ref, 'prompt_bytes': prompt_bytes, 'native_call_sha256': manifest_row['native_call_sha256']})

    return rows, None


def main() -> int:
    if len(sys.argv) > 1:
        print('refused: this helper takes no arguments', file=sys.stderr)
        return 2

    rows, err = _verified_rows()
    if err:
        print(err, file=sys.stderr)
        return 2
    if not rows:
        print('refused: frozen queue named zero conditions — nothing to materialize', file=sys.stderr)
        return 2

    out_dir_abs = _abs(OUT_DIR)
    planned = []
    for row in rows:
        filename = f"{native._safe_name(row['ref'])}.prompt.txt"
        out_path = os.path.join(out_dir_abs, filename)
        if os.path.exists(out_path):
            with open(out_path, 'rb') as fh:
                existing = fh.read()
            if existing != row['prompt_bytes']:
                print(f'refused: {OUT_DIR}/{filename} already exists with different bytes — will not overwrite', file=sys.stderr)
                return 2
        planned.append({
            'condition_ref': row['ref'],
            'filename': filename,
            'path': out_path,
            'byte_length': len(row['prompt_bytes']),
            'sha256': _sha(row['prompt_bytes']),
            'native_call_sha256': row['native_call_sha256'],
            'bytes': row['prompt_bytes'],
        })

    index_doc = {
        'schema': 'g2d-prompt-transport-index-v1',
        'source_manifest': native.OUT_PATH.replace('\\', '/'),
        'row_count': len(planned),
        'rows': [
            {k: v for k, v in p.items() if k not in ('path', 'bytes')}
            for p in planned
        ],
    }
    index_bytes = (json.dumps(index_doc, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    index_abs = _abs(INDEX_PATH)
    if os.path.exists(index_abs):
        with open(index_abs, 'rb') as fh:
            existing_index = fh.read()
        if existing_index != index_bytes:
            print(f'refused: {INDEX_PATH} already exists with different bytes — will not overwrite', file=sys.stderr)
            return 2

    # ALL rows and the index verified/dry-checked above — nothing is written until every one of
    # them is known-safe, so a mid-run refusal can never leave a partial materialization behind.
    os.makedirs(out_dir_abs, exist_ok=True)
    for p in planned:
        if not os.path.exists(p['path']):
            with open(p['path'], 'wb') as fh:
                fh.write(p['bytes'])
    if not os.path.exists(index_abs) or open(index_abs, 'rb').read() != index_bytes:
        with open(index_abs, 'wb') as fh:
            fh.write(index_bytes)

    print(f'WROTE {len(planned)} prompt artifacts + index to {OUT_DIR}')
    for p in planned:
        print(f"  {p['condition_ref']:<34} {p['sha256'][:16]}  {p['byte_length']} bytes -> {p['filename']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
