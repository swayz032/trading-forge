// F-1 fixture: a REAL occurrence living in the second --surface. If that surface
// is dropped (typo, permission, symlink), this file vanishes and the tool must
// DENY the claim rather than report a clean absence.
import { writeFileSync } from "fs";
export function save(p: string, d: string): void { writeFileSync(p, d); }
