// @ts-nocheck
// Probe stub for expo-sqlite: backs the real query layer with node:sqlite.
import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | null = null;

export async function openDatabaseAsync(name: string, _opts?: unknown) {
  if (!db) db = new DatabaseSync(":memory:");
  const d = db;
  return {
    execAsync: async (sql: string) => {
      d.exec(sql);
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      const stmt = d.prepare(sql);
      // node:sqlite binds Buffer for BLOB; expo-sqlite on-device takes Uint8Array.
      const bound = params?.map((p) => (p instanceof Uint8Array ? Buffer.from(p) : p));
      const res = bound && bound.length ? stmt.run(...bound) : stmt.run();
      return { changes: res.changes, lastInsertRowId: Number(res.lastInsertRowid) };
    },
    getFirstAsync: async (sql: string, params?: unknown[]) => {
      const stmt = d.prepare(sql);
      return (params && params.length ? stmt.get(...params) : stmt.get()) ?? null;
    },
    getAllAsync: async (sql: string, params?: unknown[]) => {
      const stmt = d.prepare(sql);
      return params && params.length ? stmt.all(...params) : stmt.all();
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      d.exec("BEGIN");
      try {
        await fn();
        d.exec("COMMIT");
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
