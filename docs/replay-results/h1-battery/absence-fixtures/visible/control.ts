// THE POSITIVE CONTROL, in the surface that SURVIVES the typo.
import { writeFileSync } from "fs";
export function ctl(p: string, d: string): void { writeFileSync(p, d); }
