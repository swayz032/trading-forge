import pino from "pino";

const isTestRuntime = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const logger = pino({
  level: isTestRuntime ? "silent" : (process.env.LOG_LEVEL || "info"),
  transport:
    !isTestRuntime && process.env.NODE_ENV === "development"
      ? { target: "pino-pretty" }
      : undefined,
});
