// FIXTURE (must be NON-ZERO): a same-named LOCAL function, no fs import at all.
export function writeFileSync(path: string, data: string): void {
  console.error("not the node api", path, data.length);
}
writeFileSync("x", "y");
