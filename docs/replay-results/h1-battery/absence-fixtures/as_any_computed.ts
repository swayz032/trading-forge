// MUST BE 8 (UNDECIDABLE): idiomatic TS cast then computed member access.
import * as fs from "fs";
export function save(p: string, d: string, m: string): void {
  (fs as any)[m](p, d);
}
