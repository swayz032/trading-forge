import { computeFeeBps } from './pricing';
export const feeA = (q: number, p: number) => computeFeeBps(q, p);
