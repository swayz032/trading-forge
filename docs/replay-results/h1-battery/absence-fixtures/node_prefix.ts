// MUST BE 0 when queried as --module fs: "node:fs" and "fs" are the SAME module
// identity, and normalisation must be used for MATCHING, not only display.
import { writeFileSync } from "node:fs";
export function save(p: string, d: string): void { writeFileSync(p, d); }
