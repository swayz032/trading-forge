export function computeFeeBps(qty: number, px: number): number {
  return qty * px * 0.0001;
}
