// scripts/rails/cert-diff.cjs — pure night-over-night certificate diff.
// verdict "green" iff every invariant passes tonight; "drift" iff ANY invariant fails.
// `changes` lists every check whose status flipped vs the previous night (both directions —
// a recovery fail→pass still lands green but is surfaced in the digest). First night (no prev)
// has no changes; its verdict keys purely on whether anything failed.
"use strict";

function diffCertificates(prev, curr) {
  const changes = [];
  for (const name of Object.keys(curr.checks)) {
    const to = curr.checks[name];
    const from = prev && prev.checks ? prev.checks[name] : undefined;
    if (prev && from !== undefined && from !== to) {
      changes.push({ check: name, from, to });
    }
  }
  const anyFail = Object.values(curr.checks).some((v) => v === "fail");
  const verdict = anyFail ? "drift" : "green";
  return { verdict, changes, anyFail };
}

module.exports = { diffCertificates };
