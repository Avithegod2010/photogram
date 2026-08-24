import * as SQLite from "expo-sqlite";
import { DB_NAME, migrationsAfter } from "./schema";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME, {
        useNewConnection: false,
      });
      await db.execAsync("PRAGMA journal_mode = WAL");
      await db.execAsync("PRAGMA foreign_keys = ON");
      await runMigrations(db);
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)"
  );
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'schema_version'"
  );
  const currentVersion = row ? parseInt(row.value, 10) : 0;
  const pending = migrationsAfter(currentVersion);
  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.up);
      await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [
        String(migration.version),
      ]);
    });
  }
}
