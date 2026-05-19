import { scoreVideoTitle } from "../src/server/services/autonomous-scout-runner.js";
const titles = [
  "My Favorite Futures Trading Strategy (Liquidity Sweeps)",
  "Bollinger Bands Mean Reversion Strategy",
  "RSI Reversal Setup for Futures",
  "Wyckoff Spring Pattern Day Trading",
  "MACD Crossover Strategy Explained",
  "Why ORB Traders Lose Money - Exposed",
];
for (const t of titles) console.log(JSON.stringify({title:t.slice(0,40),...scoreVideoTitle(t)}));
