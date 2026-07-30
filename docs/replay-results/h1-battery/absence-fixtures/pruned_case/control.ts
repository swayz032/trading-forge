// F-4 fixture, pre-registered in R-475 §3(b) / AR-476.
// THE POSITIVE CONTROL, in a READABLE SIBLING of the excluded directory -- so the
// control is fine, the search is demonstrably capable, and the ONLY thing wrong is
// that a directory left the surface. That is what makes the pair diagnostic.
import { writeFileSync } from "fs";
export function ctl(p: string, d: string): void { writeFileSync(p, d); }
