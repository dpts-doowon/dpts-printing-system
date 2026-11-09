import { appendFileSync } from "node:fs";

export type Level = "info" | "warn" | "error";
export interface Logger {
  log(level: Level, msg: string, extra?: Record<string, unknown>): void;
}

/** JSON Lines em stdout (e em arquivo, se informado). Nunca recebe o token. */
export function createLogger(
  filePath: string | null,
  now: () => number = Date.now,
  out: (line: string) => void = (l) => process.stdout.write(l),
): Logger {
  return {
    log(level, msg, extra) {
      const line =
        JSON.stringify({ at: new Date(now()).toISOString(), level, msg, ...extra }) + "\n";
      out(line);
      if (filePath) {
        try {
          appendFileSync(filePath, line);
        } catch {
          /* log em arquivo é melhor esforço; não derruba o agente */
        }
      }
    },
  };
}
