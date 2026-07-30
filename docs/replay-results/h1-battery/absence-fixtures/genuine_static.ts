// FIXTURE (must be ZERO): genuine static named import from the named module.
import { writeFileSync } from "fs";
export function save(p: string, data: string): void { writeFileSync(p, data); }
