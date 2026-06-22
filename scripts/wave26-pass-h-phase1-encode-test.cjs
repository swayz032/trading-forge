require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const quality = "rich";
    const stringified = JSON.stringify(quality);
    console.log("stringified:", JSON.stringify(stringified), "len:", stringified.length);

    // Test 1: pass JSON.stringify(...) as parameter then ::jsonb
    const r1 = await sql`SELECT ${stringified}::jsonb as v, jsonb_typeof(${stringified}::jsonb) as t, length((${stringified}::jsonb)::text) as raw_len`;
    console.log("Test 1 (JSON.stringify + ::jsonb):", r1[0]);

    // Test 2: pass bare string as ::jsonb
    const r2 = await sql`SELECT ${quality}::jsonb as v, jsonb_typeof(${quality}::jsonb) as t`.catch(e => ({error: e.message}));
    console.log("Test 2 (bare ::jsonb):", r2[0] || r2);

    // Test 3: extract via ->> on r1's value placed inside an object
    const r3 = await sql`SELECT (jsonb_build_object('x', ${stringified}::jsonb))->>'x' as extracted, length((jsonb_build_object('x', ${stringified}::jsonb))->>'x') as len`;
    console.log("Test 3 (->> extract):", r3[0]);

    // Test 4: to_jsonb(text) form
    const r4 = await sql`SELECT to_jsonb(${quality}::text) as v, jsonb_typeof(to_jsonb(${quality}::text)) as t, (jsonb_build_object('x', to_jsonb(${quality}::text)))->>'x' as extracted`;
    console.log("Test 4 (to_jsonb(text)):", r4[0]);
  } finally {
    await sql.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
