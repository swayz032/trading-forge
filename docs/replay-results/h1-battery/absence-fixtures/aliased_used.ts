// MUST BE 0: aliased import that IS used. The local binding is `wfs`, not the
// exported symbol name.
import { writeFileSync as wfs } from "fs";
export function save(p: string, d: string): void { wfs(p, d); }
