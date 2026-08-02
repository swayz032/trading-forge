// Imported FIRST by run.mjs so it patches fs before any rule module performs a read.
// Purpose: measure SEPARABILITY by observed reads rather than by grepping our own source.
import fs from 'node:fs';

export const OPENED = new Set();
const wrap = (name) => {
  const orig = fs[name];
  if (typeof orig !== 'function') return;
  fs[name] = function (p, ...rest) {
    try { OPENED.add(String(p)); } catch { /* non-string handle */ }
    return orig.call(this, p, ...rest);
  };
};
['readFileSync', 'openSync', 'readFile', 'open'].forEach(wrap);
