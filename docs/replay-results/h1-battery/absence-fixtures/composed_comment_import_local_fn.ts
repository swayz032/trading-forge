// COMPOSED-1 (must be NON-ZERO). R-471 §1: the ONLY fs import is inside this
// comment, and writeFileSync below is an UNRELATED LOCAL FUNCTION.
// import { writeFileSync } from "fs";
export function writeFileSync(p: string, d: string): void {
  console.error("local, not the node api", p, d.length);
}
writeFileSync("a", "b");
