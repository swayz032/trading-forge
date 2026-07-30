// FIXTURE (must be NON-ZERO): a real dynamic import, but of an UNRELATED module,
// and it does not bind writeFileSync.
export async function go(p: string) {
  const { join } = await import("path");
  const { createHash } = await import("crypto");
  return createHash("sha256").update(join(p, "a")).digest("hex");
}
