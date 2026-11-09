import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import type { Journal, JournalEntry } from "@doowon/printer-contracts";

/** Journal em arquivo JSON Lines com fsync a cada entrada (durável contra reinício do PC). */
export class FileJournal implements Journal {
  constructor(private path: string) {}

  append(entry: JournalEntry): void {
    const fd = openSync(this.path, "a");
    try {
      appendFileSync(fd, JSON.stringify(entry) + "\n", "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  readAll(): JournalEntry[] {
    if (!existsSync(this.path)) return [];
    const text = readFileSync(this.path, "utf8");
    const entries: JournalEntry[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      entries.push(JSON.parse(line) as JournalEntry); // lança se corrompido
    }
    return entries;
  }
}

export class MemoryJournal implements Journal {
  entries: JournalEntry[] = [];
  corrupted = false;
  append(entry: JournalEntry): void {
    this.entries.push(structuredClone(entry));
  }
  readAll(): JournalEntry[] {
    if (this.corrupted) throw new Error("journal corrompido");
    return structuredClone(this.entries);
  }
}
