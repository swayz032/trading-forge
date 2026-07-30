import { computeFeeBps } from './pricing';
export const feeB = (q: number, p: number) => computeFeeBps(q, p);
