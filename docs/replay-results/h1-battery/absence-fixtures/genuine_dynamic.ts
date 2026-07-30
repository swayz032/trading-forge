// FIXTURE (must be ZERO): genuine dynamically-destructured import from the module.
export async function save(p: string, data: string): Promise<void> {
  const { writeFileSync } = await import("fs");
  writeFileSync(p, data);
}
