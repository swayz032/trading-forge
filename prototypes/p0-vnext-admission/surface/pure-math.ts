// A demonstrably INERT local helper: its closure reaches no ledger, oracle, filesystem or
// network module. Row 53 imports it and must red SOLELY because the admitted import count
// is 0 -- the CARDINALITY policy -- and NOT because of anything this module can do.
export const add = (a: number, b: number): number => a + b;
// A TYPE export, so the type-only-import position of item 10 has something real to import.
export type Addend = number;
