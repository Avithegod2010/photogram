// Read-only inspector for a DB pulled off the phone (adb run-as). Prints the
// numbers the device-verification checklist cares about: schema version, media
// state split, upload queue, byte totals, and the newest uploads.
// Usage: node scripts/inspect-device-db.mjs <path-to-photogram.db>
import { DatabaseSync } from "node:sqlite";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/inspect-device-db.mjs <photogram.db>");
  process.exit(2);
}

const db = new DatabaseSync(file, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params);

function section(title) {
  console.log(`\n== ${title} ==`);
}

try {
  const version = one("PRAGMA user_version");
  section("schema");
  console.log("user_version:", version?.user_version ?? "(none)");

  section("media by state");
  for (const row of all(
    "SELECT state, COUNT(*) AS n, COALESCE(SUM(byte_size),0) AS bytes FROM media GROUP BY state ORDER BY n DESC"
  )) {
    console.log(`${String(row.state).padEnd(14)} ${String(row.n).padStart(7)}  ${(row.bytes / 1048576).toFixed(1)} MB`);
  }

  section("visibility");
  for (const row of all(
    "SELECT visibility, COUNT(*) AS n FROM media GROUP BY visibility ORDER BY n DESC"
  )) {
    console.log(`${String(row.visibility).padEnd(14)} ${String(row.n).padStart(7)}`);
  }

  section("totals");
  const totals = one(
    "SELECT COUNT(*) AS n, COALESCE(SUM(byte_size),0) AS bytes, " +
      "SUM(CASE WHEN local_uri IS NULL THEN 1 ELSE 0 END) AS cloud_only, " +
      "SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS favorites FROM media"
  );
  console.log(
    `rows=${totals.n} bytes=${(totals.bytes / 1073741824).toFixed(2)} GB cloud_only=${totals.cloud_only ?? 0} favorites=${totals.favorites ?? 0}`
  );

  section("upload queue (not synced)");
  for (const row of all(
    "SELECT state, COUNT(*) AS n FROM media WHERE state != 'synced' GROUP BY state ORDER BY n DESC"
  )) {
    console.log(`${String(row.state).padEnd(14)} ${String(row.n).padStart(7)}`);
  }

  section("newest uploads");
  for (const row of all(
    "SELECT id, state, file_name, byte_size, uploaded_at, remote_message_id FROM media " +
      "WHERE uploaded_at IS NOT NULL ORDER BY uploaded_at DESC LIMIT 5"
  )) {
    console.log(
      `#${row.id} ${new Date(Number(row.uploaded_at)).toISOString()} ${row.state} ${row.file_name} ` +
        `${row.byte_size}B msg=${row.remote_message_id ?? "-"}`
    );
  }

  section("meta");
  try {
    for (const row of all("SELECT key, substr(value, 1, 80) AS v FROM meta ORDER BY key")) {
      console.log(`${row.key} = ${row.v}`);
    }
  } catch {
    console.log("(no meta table)");
  }

  section("freeable candidates (v0.51 rails)");
  const freeable = one(
    "SELECT COUNT(*) AS n, COALESCE(SUM(byte_size),0) AS bytes FROM media " +
      "WHERE state = 'synced' AND visibility = 'visible' AND is_favorite = 0 " +
      "AND local_uri IS NOT NULL AND media_library_id IS NOT NULL AND taken_at > 0 " +
      "AND taken_at < ?",
    Date.now() - 7 * 24 * 60 * 60 * 1000
  );
  console.log(`eligible=${freeable.n} bytes=${(freeable.bytes / 1048576).toFixed(1)} MB`);
} finally {
  db.close();
}
