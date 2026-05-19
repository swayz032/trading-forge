import { spawn } from "child_process";
import { resolve } from "path";

const PROJECT_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
console.log("PROJECT_ROOT:", PROJECT_ROOT);

const p = spawn("python3", ["--version"], { cwd: PROJECT_ROOT });
p.stdout.on("data", (d: Buffer) => process.stdout.write(d.toString()));
p.stderr.on("data", (d: Buffer) => process.stderr.write(d.toString()));
p.on("exit", (c: number | null) => { console.log("exit:", c); process.exit(0); });
p.on("error", (e: Error) => { console.error("error:", e.message); process.exit(1); });
