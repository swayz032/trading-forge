import { chunkTranscript, mergeChunkResults } from "../src/server/lib/transcript-chunker.js";

const text = "x".repeat(24720);
const chunks = chunkTranscript(text);
console.log(`chunks=${chunks.length} sizes=[${chunks.map(c => c.length).join(",")}]`);

const merged = mergeChunkResults([
  { strategies: [{ name: "A", direction: "long", entry_sequence: [{ step: 1, action: "a" }] }], rejected_strategies: [], instrument_classification: "futures_primary" },
  { strategies: [{ name: "A", direction: "both", entry_sequence: [{ step: 1, action: "a" }, { step: 2, action: "b" }], confluences: [{ name: "FVG" }] }], rejected_strategies: ["rej1"], instrument_classification: null },
  { strategies: [{ name: "B", direction: "short", entry_sequence: [] }], rejected_strategies: [], instrument_classification: "non_futures_primary" },
]);
console.log(JSON.stringify(merged, null, 2));
