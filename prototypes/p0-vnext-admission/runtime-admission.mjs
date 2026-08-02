// 1b-R — RUNTIME INPUT ADMISSION for the value handed to project().
// Composite walk, all four required parts:
//   (i)   own property-descriptor inspection  (Object.getOwnPropertyDescriptors)
//   (ii)  symbol-visible enumeration          (Reflect.ownKeys, never Object.keys)
//   (iii) recursive prototype-identity check  (own-descriptors are own-only)
//   (iv)  ACTIVE-PATH cycle policy            (released on unwind; a permanent
//         visited-set FALSE-REJECTS a legitimate DAG)
//
// Reads no ledger. Invokes nothing: the getter invocation counter must stay 0.

export const CATCHERS = {
  ACCESSOR: '1b-R:accessor-descriptor',
  FUNCTION_VALUE: '1b-R:function-valued-field',
  SYMBOL_KEY: '1b-R:symbol-key',
  NON_ENUMERABLE: '1b-R:non-enumerable-field',
  VALUE_CLASS: '1b-R:value-class',
  PROTOTYPE: '1b-R:prototype-identity',
  CYCLE: '1b-R:cycle',
  ARRAY_SHAPE: '1b-R:array-shape',
};

const isPlainRoot = (v) => {
  const p = Object.getPrototypeOf(v);
  if (Array.isArray(v)) return p === Array.prototype;
  return p === Object.prototype || p === null;
};

export function admitRuntime(value) {
  const violations = [];
  const active = new Set();          // ACTIVE PATH, not a permanent visited-set
  const push = (catcher, path) => violations.push({ catcher, path });

  const walk = (v, path) => {
    // ---- leaves
    if (v === null) return;
    const t = typeof v;
    if (t === 'string' || t === 'boolean') return;
    if (t === 'number') {
      if (!Number.isFinite(v)) push(CATCHERS.VALUE_CLASS, `${path}: ${Object.is(v, NaN) ? 'NaN' : String(v)}`);
      return;
    }
    if (t === 'undefined') { push(CATCHERS.VALUE_CLASS, `${path}: undefined`); return; }
    if (t === 'bigint') { push(CATCHERS.VALUE_CLASS, `${path}: bigint`); return; }
    if (t === 'symbol') { push(CATCHERS.VALUE_CLASS, `${path}: symbol value`); return; }
    if (t === 'function') { push(CATCHERS.FUNCTION_VALUE, `${path}: function value`); return; }

    // ---- containers
    if (active.has(v)) { push(CATCHERS.CYCLE, `${path}: cycle`); return; }
    if (!isPlainRoot(v)) {
      push(CATCHERS.PROTOTYPE, `${path}: prototype is not Object.prototype/null/Array.prototype`);
      return;                                   // do not descend into a foreign prototype
    }
    active.add(v);

    const descs = Object.getOwnPropertyDescriptors(v);
    for (const key of Reflect.ownKeys(v)) {     // SYMBOL-VISIBLE: never Object.keys
      const label = typeof key === 'symbol' ? `symbol(${key.description})` : key;
      const d = descs[key];
      if (typeof key === 'symbol') { push(CATCHERS.SYMBOL_KEY, `${path}.${label}`); continue; }
      if (Array.isArray(v) && key === 'length') continue;           // own but non-enumerable
      if (!d.enumerable) { push(CATCHERS.NON_ENUMERABLE, `${path}.${label}`); continue; }
      if (typeof d.get === 'function' || typeof d.set === 'function') {
        push(CATCHERS.ACCESSOR, `${path}.${label}`);                // NOT invoked: descriptor only
        continue;
      }
      if (typeof d.value === 'function') { push(CATCHERS.FUNCTION_VALUE, `${path}.${label}`); continue; }
      if (Array.isArray(v) && !/^\d+$/.test(String(key))) {
        push(CATCHERS.ARRAY_SHAPE, `${path}.${label}: extra named array property`);
        continue;
      }
      walk(d.value, `${path}.${label}`);
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) push(CATCHERS.ARRAY_SHAPE, `${path}[${i}]: sparse hole`);
      }
    }
    active.delete(v);                            // RELEASED ON UNWIND -> a DAG stays GREEN
  };

  walk(value, '$');
  return { ok: violations.length === 0, violations };
}
