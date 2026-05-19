import { spawn } from "child_process";

const commands = ["python3", "python", "/c/Program Files/Python313/python"];

for (const cmd of commands) {
  const p = spawn(cmd, ["--version"]);
  const result = await new Promise<string>((resolve) => {
    let out = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.stderr.on("data", (d: Buffer) => (out += d.toString()));
    p.on("exit", (c: number | null) => resolve(`EXIT ${c}: ${out.trim()}`));
    p.on("error", (e: Error) => resolve(`ERROR: ${e.message}`));
  });
  console.log(`  ${cmd}: ${result}`);
}
process.exit(0);
