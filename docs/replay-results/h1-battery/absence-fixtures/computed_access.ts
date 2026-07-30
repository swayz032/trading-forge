// FIXTURE (must be NON-ZERO -- R-470 §1(ii)): a REAL write reached by computed
// member access on a statically imported namespace. ZERO literal occurrences of
// the symbol, so a literal-text search cannot decide this. FAIL CLOSED.
import * as fs from "fs";
export function save(p: string, data: string): void {
  fs[("write" + "File" + "Sync") as "writeFileSync"](p, data);
}
