import { readFileSync } from 'node:fs';
export const readLedger = () => JSON.parse(readFileSync('state/ledger.json', 'utf8'));
