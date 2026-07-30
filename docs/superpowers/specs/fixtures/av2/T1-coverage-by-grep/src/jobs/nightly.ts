// Nightly reconciliation. Loads the legacy fee module dynamically.
export async function nightly(qty: number, px: number): Promise<number> {
  const mod: Record<string, unknown> = await import('./legacy-fees.js');
  const fn = mod['compute' + 'Fee'] as ((q: number, p: number) => number) | undefined;
  if (!fn) throw new Error('legacy fee fn missing');
  return fn(qty, px);
}
