// scripts/lib/false-success-lint.cjs — a NARROW guard against the false-success class.
//
// THE CLASS (three project sightings: kill-switch 07-12, rail-crash-handler 07-19,
// env-resolver 07-20) is SEMANTIC, not syntactic: a caller CLAIMS success on the strength
// of "no exception was thrown" while the callee reports failure by RETURN VALUE.
//   postDiscord   -> {ok:false}      never throws
//   dotenv.config -> {error}         never throws
//   fetch         -> res.ok === false on 4xx/5xx, never throws
//
// ★ WHY THIS LINT IS DELIBERATELY SMALL (OR-086 recalibration).
// The obvious version — flag every `void call(` and every `try{fetch}catch{}` — would
// red-flag code that is CORRECT: `void insertAuditRowSafe(...)` (the best-effort audit
// idiom), soak-watcher's secondary Discord alerts that sit behind a durable ledger row and
// claim nothing, and awaits on Drizzle calls that genuinely throw. A lint that cries wolf
// trains the operator to ignore it — the same failure mode as an alert that fires daily,
// and this campaign has already built one of those by accident.
//
// So it flags only two shapes, both requiring a NAMED status-returning callee:
//   R1 void_discards_status  — `void <allowlisted>(`: the return is the ONLY failure
//                              channel and `void` throws it away at the syntax level.
//   R2 fetch_status_unread   — a `fetch(` whose response `.ok`/`.status`/`StatusCode` is
//                              never read nearby. Divergence from the reference impl
//                              (rail-runtime.postDiscord), which checks `!response.ok`.
//
// Suppression is explicit and must carry a reason:  // LINT-OK(R1): <why>
// Non-blocking in CI first; promote only once the whole ops surface runs clean.
"use strict";

/** Callees whose ONLY failure channel is the returned value. Extend deliberately. */
const STATUS_RETURNING = ["postDiscord", "callSink", "loadEnvFile", "notifyFn", "writeLedgerFn"];

const RULES = {
  R1: "void_discards_status",
  R2: "fetch_status_unread",
};

/** Strip comments so prose mentioning a pattern is never a finding — and so LINT-OK is read first. */
function suppressedLines(src) {
  const out = new Set();
  src.split("\n").forEach((line, i) => {
    const m = line.match(/LINT-OK\((R\d)\)\s*:/);
    if (m) { out.add(`${i + 1}:${m[1]}`); out.add(`${i + 2}:${m[1]}`); } // same line or the next
  });
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
            .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

function lintSource(src, file = "<src>") {
  const findings = [];
  const suppressed = suppressedLines(src);
  const code = stripComments(src);
  const lines = code.split("\n");

  lines.forEach((line, idx) => {
    const n = idx + 1;

    // R1 — void on a callee whose only failure signal is its return value.
    const v = line.match(/\bvoid\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (v && STATUS_RETURNING.includes(v[1]) && !suppressed.has(`${n}:R1`)) {
      findings.push({ file, line: n, rule: RULES.R1, callee: v[1] });
    }

    // R2 — a fetch whose response status is never read within the following few lines.
    if (/\bfetch\s*\(/.test(line) && !suppressed.has(`${n}:R2`)) {
      const window = lines.slice(idx, idx + 8).join("\n");
      const reads = /\.ok\b|\.status\b|StatusCode|\bstatus\s*[,)]/.test(window);
      if (!reads) findings.push({ file, line: n, rule: RULES.R2, callee: "fetch" });
    }
  });
  return findings;
}

function formatFindings(findings) {
  if (findings.length === 0) return "false-success lint: clean";
  return findings
    .map((f) => `${f.file}:${f.line}  ${f.rule}  (${f.callee}) — the return value is the only failure channel; read it or annotate // LINT-OK`)
    .join("\n");
}

module.exports = { STATUS_RETURNING, RULES, lintSource, formatFindings, stripComments };
