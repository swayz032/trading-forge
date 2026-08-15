import fs from 'node:fs';

const REQUIRED = ['job','worker','branch','commit','files_changed','red','green','control','pushed','stopped_for_gpt'];

function cleanString(s) {
  return String(s)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/\b(API_KEY|TOKEN|PASSWORD|SECRET)=([^\s]+)/gi, '$1=[REDACTED]');
}

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = /secret|token|password|api[_-]?key/i.test(k) ? '[REDACTED]' : redact(val);
    return o;
  }
  return typeof v === 'string' ? cleanString(v) : v;
}

export function validateReceipt(input) {
  for (const k of REQUIRED) if (!(k in input)) throw new Error(`missing required field: ${k}`);
  if (!Array.isArray(input.files_changed)) throw new Error('files_changed must be an array');
  for (const phase of ['red','green']) {
    if (!input[phase] || typeof input[phase].command !== 'string' || typeof input[phase].result !== 'string') throw new Error(`${phase} must contain command and result`);
  }
  if (input.pushed !== true) throw new Error('pushed must be true before publishing receipt');
  if (input.stopped_for_gpt !== true) throw new Error('stopped_for_gpt must be true before publishing receipt');
  return redact(input);
}

export function renderReceipt(input) {
  const r = validateReceipt(input);
  return [
    `# ${r.job} — WORKER EVIDENCE RECEIPT`, '',
    `- Worker: ${r.worker}`,
    `- Branch: ${r.branch}`,
    `- Commit: ${r.commit}`,
    `- Files: ${r.files_changed.length ? r.files_changed.join(', ') : '(none)'}`,
    `- RED: \`${r.red.command}\` → ${r.red.result}`,
    `- GREEN: \`${r.green.command}\` → ${r.green.result}`,
    `- Control: ${typeof r.control === 'string' ? r.control : JSON.stringify(r.control)}`,
    `- Pushed: YES`,
    `- Stopped for GPT: YES`,
    r.known_limit ? `- Known limit: ${r.known_limit}` : null,
    ''
  ].filter(x => x !== null).join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const idx = process.argv.indexOf('--input');
  if (idx < 0 || !process.argv[idx + 1]) { console.error('usage: node evidence-receipt.mjs --input receipt.json [--output receipt.md]'); process.exit(2); }
  try {
    const data = JSON.parse(fs.readFileSync(process.argv[idx + 1], 'utf8'));
    const out = renderReceipt(data);
    const oi = process.argv.indexOf('--output');
    if (oi >= 0 && process.argv[oi + 1]) fs.writeFileSync(process.argv[oi + 1], out); else process.stdout.write(out);
  } catch (err) { console.error(err.message); process.exitCode = 2; }
}
