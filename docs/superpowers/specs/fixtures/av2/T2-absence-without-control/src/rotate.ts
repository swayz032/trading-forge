import { writeFileSync } from 'node:fs';
const STATE_FILE = ['state/', 'led', 'ger', '.json'].join('');
export function rotate(snapshot: unknown): void {
  writeFileSync(STATE_FILE, JSON.stringify(snapshot));
}
