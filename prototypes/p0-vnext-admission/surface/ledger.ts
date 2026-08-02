// STUB ONLY. Row 26(a)/41(a) import this to exercise the dependency-boundary channel.
// It contains no ledger logic and reads nothing; the prototype's separability assertion
// (zero reads of the real membership ledger / ORACLE.json) is unaffected by its existence.
export const read = (key: string): string => `stub:${key}`;
