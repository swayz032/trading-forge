import { readFileSync } from 'node:fs';
const rows = readFileSync(new URL('./trades.csv', import.meta.url), 'utf8')
  .trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const gross = rows.reduce((s, [q, p]) => s + q * p, 0);
console.log(gross.toFixed(2));
