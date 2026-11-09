import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

export class AlreadyRunningError extends Error {}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Trava de instância única: dois agentes sobre o mesmo journal/posto poderiam imprimir a mesma
 * etiqueta duas vezes. Uma trava deixada por um processo que não existe mais é reaproveitada.
 * Retorna a função que libera a trava.
 */
export function acquireLock(path: string, pid: number = process.pid): () => void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(pid));
      closeSync(fd);
      return () => {
        try {
          if (readFileSync(path, "utf8").trim() === String(pid)) unlinkSync(path);
        } catch {
          /* já removida */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const owner = Number(readFileSync(path, "utf8").trim());
      if (Number.isInteger(owner) && owner > 0 && alive(owner))
        throw new AlreadyRunningError(
          `Já existe um Print Agent em execução para este journal (PID ${owner}).`,
        );
      unlinkSync(path); // trava obsoleta
    }
  }
  throw new AlreadyRunningError("Não foi possível obter a trava de instância única.");
}
