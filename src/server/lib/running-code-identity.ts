import { execFileSync } from "node:child_process";

export interface RunningCodeIdentity {
  commit: string;
  dirty: boolean;
}

export type GitCommandRunner = (command: string, args: string[]) => string;

const defaultRunner: GitCommandRunner = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", timeout: 4_000 });

export function readRunningCodeIdentity(
  envCommit = process.env.GIT_COMMIT,
  run: GitCommandRunner = defaultRunner,
): RunningCodeIdentity {
  const declaredCommit = envCommit?.trim();
  try {
    const prefix = ["-c", "safe.directory=*"];
    const commit = run("git", [...prefix, "rev-parse", "HEAD"]).trim();
    const dirty =
      run("git", [...prefix, "status", "--porcelain"]).trim().length > 0 ||
      Boolean(declaredCommit && declaredCommit !== commit);
    return { commit, dirty };
  } catch {
    return { commit: declaredCommit || "unknown", dirty: true };
  }
}
