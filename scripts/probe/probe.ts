// @ts-nocheck
// REVIEW PROBE — runs the REAL Photogram stack in Node:
// real schema migrations (node:sqlite via an expo-sqlite stub), real
// queries.ts CRUD, real similar.ts engine, real imageAnalysis pHash math,
// real jpeg-js decode of synthetic JPEGs. Only React-Native-native modules
// are stubbed. Every check prints PASS/FAIL; exit code reflects failures.
import { DatabaseSync } from "node:sqlite";
import { getDb } from "../../src/db/index";
import { MIGRATIONS } from "../../src/db/schema";
import {
  insertMedia,
  getMediaByIds,
  updateMediaPhash,
  updateMediaLabels,
  updateMediaUserTags,
  updateMediaSharpness,
  setMediaNote,
  setMediaRemote,
  listPhashRows,
  countMissingAnalysis,
  listMissingAnalysis,
  searchMediaRaw,
  searchMediaFiltered,
  getMeta,
  clearRemotePointers,
  setMediaVisibility,
  saveSearch,
  listSavedSearches,
  getSavedSearch,
  deleteSavedSearch,
  listNotedMedia,
  getDbDiagnostics,
  replaceFaceSamples,
  hasFaceSamples,
  setFaceEmbedding,
  listPeople,
  listFacesForPerson,
  countScenePhotos,
  listScenePhotos,
  createPerson,
  assignFacesToPerson,
  renamePerson,
} from "../../src/db/queries";
import {
  listAllEmbeddingsForClustering,
  listPeopleFull,
  listFaceRejections,
  rejectSamplesFromPerson,
  splitSamplesOff,
  mergePeopleInto,
  deletePerson,
  countFacesOfPerson,
  setPersonSensitivity,
  countMergedInTrash,
  restoreMergedFromTrash,
  countDocPhotos,
  listDocPhotos,
  updateOcrText,
  getDigestStats,
} from "../../src/db/queries";
import {
  saveSmartRules,
  runRulesSearch,
  parseRules,
  countFavoriteAnniversaries,
  setMediaFavorite,
  searchPeopleForQuery,
  renamePerson,
  listAlbumActivity,
  listAlbumMedia,
  createSharedAlbum,
} from "../../src/db/queries";
import { composeRequestText, sendPhotoRequest } from "../../src/lib/photoRequest";
import { getWrapped } from "../../src/lib/wrapped";
import { computeHealth, gradeFor } from "../../src/lib/healthScore";
import { pickDrillSample, summarizeDrill, runRestoreDrill } from "../../src/lib/restoreDrill";
import { parseNaturalSearch, runNaturalSearch } from "../../src/lib/naturalSearch";
import { integrityNeedsAlert } from "../../src/lib/integritySchedule";
import { normalizeUserTags, mergeTagList, MAX_TAGS_PER_PHOTO } from "../../src/lib/tags";
import { shouldHash, verifyChecksum } from "../../src/lib/checksum";
import { buildShortcutItems, parseShortcutId, MAX_SHORTCUTS } from "../../src/lib/shortcuts";
import { buildWallpaperConfig, MAX_WALLPAPER_PATHS } from "../../src/lib/wallpaper";
import { parseSharedInbox, MAX_SHARED_ITEMS } from "../../src/lib/sharedInbox";
import { shouldRunMaintenance, maybeRunDbMaintenance, MAINTENANCE_KEY } from "../../src/lib/dbMaintenance";
import { appendStartupSample, medianStartupMs, STARTUP_KEEP } from "../../src/lib/startup";
import { countFreeable, listFreeableAssets, markMediaCloudOnly as clearLocalUri, recoverInterruptedUploads } from "..\/..\/src\/db\/queries";
import { buildWidgetState, syncWidgetState, tilePauseActive } from "../../src/lib/widgetState";
import { File, Paths } from "expo-file-system";
import { getAutoAlbums } from "../../src/lib/albums";
import { translate, I18N_DICT } from "../../src/lib/i18n";
import { findDuplicateGroups } from "../../src/lib/similar";
import { setAlbumCover, clearAlbumCover } from "../../src/lib/albumCovers";
import { collectOnboardingFacts, listPendingOnboardingSteps, shouldShowChecklist } from "../../src/lib/onboarding";
import { mergePeople, splitOffFaces, dismissFacesFromPerson } from "../../src/lib/people";
import { windowOpenFor, checkUploadWindow } from "../../src/lib/uploadWindow";
import { DOC_ALBUMS, getDocOverview, getDocMedia } from "../../src/lib/docAlbums";
import {
  composeDigest,
  monthKey,
  maybeRunMonthlyDigest,
  setDigestPoster,
  DIGEST_LAST_KEY,
} from "../../src/lib/digest";
import {
  parseManifest,
  dryRunImport,
  applyImport,
} from "../../src/lib/importManifest";
import { quickFingerprint } from "../../src/lib/dedupe";
import { uploadsMmkv } from "../../src/store/uploadStore";
import { useUploadStore } from "../../src/store/uploadStore";

const posterHits: string[] = [];

import { runSearch } from "../../src/lib/search";
import {
  listRejectionDetails,
  unblockRejection,
  listOnThisDay,
  listCandidateSourceFaces,
  listPersonFacesForCandidates,
} from "../../src/db/queries";
import { listPersonCandidates } from "../../src/lib/people";
import { checkAndSnapshot, runSnapshotNow, listSnapshots, lastSnapshotAt } from "../../src/lib/snapshotExport";
import { mmkv as settingsMmkv } from "../../src/store/settingsStore";
import { getLargestItems, getCategoryUsage, getMonthlyBuckets } from "../../src/lib/stats";
import { useSettingsStore } from "../../src/store/settingsStore";
import { findSimilarTo, findDuplicateGroups, backfillAnalysis } from "../../src/lib/similar";
import { getHighlights } from "../../src/lib/highlights";
import { loadIntegrityReport, runIntegrityPass } from "../../src/lib/integrity";
import { validateModelUrl, FACE_MODELS } from "../../src/lib/faceModels";
import { rgbaToModelInput, f32ToBytes, bytesToF32 } from "../../src/lib/faces";
import { backfillFaces, runClustering, FACE_COSINE_THRESHOLD } from "../../src/lib/people";
import { countFacesNeedingEmbedding } from "../../src/db/queries";
import { SCENES, getSceneOverview, getSceneMedia } from "../../src/lib/scenes";
import { mergeDuplicateGroup } from "../../src/lib/merge";import { pHash64, hamming64, decodeThumbToGray } from "../../src/lib/imageAnalysis";
import {
  shouldRunScheduledIntegrity,
  INTEGRITY_INTERVALS_MS,
} from "../../src/lib/integritySchedule";
import {
  buildManifestJson,
  buildCsv,
  csvEscape,
  bytesToHex,
  mediaToExport,
  runExport,
} from "../../src/lib/exportManifest";
import {
  listAllMediaForExport,
  listPeopleForExport,
  listFacesForExport,
} from "../../src/db/queries";
import { File as ProbeFsFile } from "expo-file-system";
import { __registerFile } from "expo-file-system";
import { NativeModules } from "react-native";
import { __openChatCount, __setResponse, __setThrowOn } from "react-native-tdlib";
import { __setLegacyFileExists } from "expo-file-system/legacy";
import { __setTfliteOutput } from "react-native-fast-tflite";
import { __setCropOutput } from "expo-image-manipulator";
import * as jpeg from "jpeg-js";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log("PASS  " + name);
  } else {
    failed++;
    console.log("FAIL  " + name + (extra ? "  —  " + extra : ""));
  }
}
function ids(rows) {
  return rows.map((r) => r.id).sort((a, b) => a - b);
}
const sameSet = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY1 = 1_700_000_000_000;
const DAY2 = DAY1 + DAY_MS;

const H1 = "0000000000000000"; // distance 0 from itself
const H2 = "00000000000000ff"; // distance 8 from H1 (== DUP_HAMMING_MAX)
const HFAR = "ffffffffffffffff"; // distance 64 from H1

async function main() {
  const db = await getDb(); // REAL db/index.ts: pragmas + migrations v1..v14

  // --- migrations ---
  const ver = await db.getFirstAsync("SELECT value FROM meta WHERE key = 'schema_version'");
  check("migrations ran to v21 on fresh DB", ver?.value === "21", "got " + ver?.value);
  const mediaCols19 = (await db.getAllAsync("PRAGMA table_info(media)")).map((c) => c.name);
  const peopleCols19 = (await db.getAllAsync("PRAGMA table_info(people)")).map((c) => c.name);
  check("v19 columns exist (media.trash_reason + people.sensitivity + face_rejections)",
    mediaCols19.includes("trash_reason") && peopleCols19.includes("sensitivity") &&
    (await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='face_rejections'")) !== null);

  // --- incremental migration on a populated v14 DB (the device-upgrade path) ---
  {
    const db2 = new DatabaseSync(":memory:");
    for (const m of MIGRATIONS.filter((m) => m.version <= 14)) db2.exec(m.up);
    db2
      .prepare(
        "INSERT INTO media (thumb_uri, file_name, mime_type, byte_size, taken_at, fingerprint, state, created_at, updated_at) VALUES ('t','legacy.jpg','image/jpeg',1,1,'fp-legacy','local',1,1)"
      )
      .run();
    db2.prepare("INSERT INTO meta (key, value) VALUES ('schema_version','14')").run();
    for (const m of MIGRATIONS.filter((m) => m.version > 14)) db2.exec(m.up);
    const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const cols = db2.prepare("PRAGMA table_info(media)").all().map((c) => c.name);
    const legacy = db2.prepare("SELECT COUNT(*) AS n FROM media").get();
    check("v15–v17 apply on populated v14 DB (saved_searches + sharpness + face_samples)",
      tables.includes("saved_searches") && tables.includes("face_samples") && cols.includes("sharpness"),
      "tables: " + tables.join(","));
    check("legacy rows survive the migration", legacy.n === 1);

    // v0.39: a POPULATED v18 DB upgrades to v19 additively (the real device path).
    const db3 = new DatabaseSync(":memory:");
    for (const m of MIGRATIONS.filter((m) => m.version <= 18)) db3.exec(m.up);
    db3
      .prepare("INSERT INTO people (name, created_at) VALUES ('Old Person', 1)")
      .run();
    db3.prepare("INSERT INTO meta (key, value) VALUES ('schema_version','18')").run();
    for (const m of MIGRATIONS.filter((m) => m.version > 18)) db3.exec(m.up);
    const oldPerson = db3.prepare("SELECT name, sensitivity FROM people WHERE name = 'Old Person'").get();
    check("v19 on populated v18: people row survives with NULL sensitivity",
      oldPerson !== null && oldPerson.name === "Old Person" && oldPerson.sensitivity === null);
    check("v19 on populated v18: face_rejections table exists",
      db3.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='face_rejections'").get() !== null);
  }

  // --- seed library ---
  const mk = async (over) =>
    insertMedia({
      local_uri: "mem://probe/local",
      thumb_uri: "mem://probe/thumb",
      file_name: "photo.jpg",
      mime_type: "image/jpeg",
      byte_size: 100,
      width: 100,
      height: 100,
      taken_at: DAY1,
      fingerprint: "fp-" + Math.random().toString(36).slice(2),
      state: "local",
      tags: "photo",
      ...over,
    });

  const A = await mk({ byte_size: 100 }); // anchor, H1
  const B = await mk({ byte_size: 500 }); // same day, distance 8 → duplicate, larger file
  const C = await mk({}); // same day, far hash
  const D = await mk({ taken_at: DAY2 }); // NEXT DAY, hash identical to A
  const E = await mk({ edited_from: A, byte_size: 99_999_997 }); // edited copy → excluded everywhere (would top "largest" if it leaked)
  const F = await mk({ byte_size: 99_999_998 }); // shared-album linked → excluded
  const G = await mk({ byte_size: 99_999_999 }); // trashed → excluded
  const I = await mk({}); // '' sentinel
  const H = await mk({ file_name: "clip.mp4", mime_type: "video/mp4", width: null, height: null }); // video, phash NULL
  const J = await mk({ thumb_uri: "mem://probe/j.jpg", byte_size: 42 }); // never hashed, real thumb bytes
  const BIG = await mk({ byte_size: 9_000_000, file_name: "big.jpg" }); // tops "largest items"
  const S1 = await mk({ byte_size: 1000, tags: "photo screenshot", file_name: "shot.png" }); // screenshot category
  const S2 = await mk({ byte_size: 2000, tags: "photo whatsapp", file_name: "wa.mp4", mime_type: "video/mp4" }); // whatsapp AND video
  const W1 = await mk({ byte_size: 500, tags: "photo download", file_name: "dl.jpg" }); // downloads category
  const NOW = await mk({ byte_size: 777, taken_at: new Date(new Date().getFullYear(), new Date().getMonth(), 15).getTime() }); // current month bucket

  for (const [id, hex] of [[A, H1], [B, H2], [C, HFAR], [D, H1], [E, H1], [F, H1], [G, H1]]) {
    await updateMediaPhash(id, hex);
  }
  await updateMediaPhash(I, "");
  const album = await db.runAsync(
    "INSERT INTO albums (title, created_at, updated_at) VALUES ('family', 1, 1)"
  );
  const albumId = album.lastInsertRowId;
  await db.runAsync("INSERT INTO album_media (album_id, media_id, added_at) VALUES (?, ?, 1)", [albumId, F]);
  await setMediaVisibility(G, "trashed");

  // real 48x32 noise JPEG registered for J (tests decode → pHash end to end)
  {
    const w = 48;
    const h = 32;
    const rgba = new Uint8Array(w * h * 4);
    let seed = 12345;
    for (let i = 0; i < rgba.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = (seed >> 16) & 0xff;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
    const encoded = jpeg.encode({ data: rgba, width: w, height: h }, 90);
    __registerFile("mem://probe/j.jpg", new Uint8Array(encoded.data));
  }

  // --- missing-hash backfill ---
  // Missing-analysis universe (phash OR sharpness missing): every image row
  // except the sentinel I — A-D,I have a phash but no sharpness yet. Videos
  // H/S2 and excluded rows E/F/G are out.
  check("countMissingAnalysis counts all image rows missing either metric (10)",
    (await countMissingAnalysis()) === 10);
  const miss0 = await listMissingAnalysis(0, 200);
  check("listMissingAnalysis returns A-D,I,J,BIG,S1,W1,NOW",
    sameSet(miss0.map((r) => r.id), [A, B, C, D, I, J, BIG, S1, W1, NOW]),
    "got " + miss0.map((r) => r.id).join(",") + " (A=" + A + " B=" + B + " C=" + C + " D=" + D + " E=" + E + " F=" + F + " G=" + G + " I=" + I + " J=" + J + " BIG=" + BIG + " S1=" + S1 + " S2=" + S2 + " W1=" + W1 + " NOW=" + NOW + ")");
  check("listMissingAnalysis cursor advances past J", (await listMissingAnalysis(J, 200)).length === 4);

  // in-context decode diagnostic (hashMissingPhotos swallows errors by design)
  {
    const { File: ProbeFile } = await import("expo-file-system");
    const probeFile = new ProbeFile("mem://probe/j.jpg");
    console.log("DIAG File.exists:", probeFile.exists, "size:", probeFile.size);
    try {
      const img = await decodeThumbToGray("mem://probe/j.jpg");
      console.log("DIAG decode ok:", img.width, "x", img.height, "gray:", img.gray?.length);
    } catch (e) {
      console.log("DIAG decode THREW:", e?.message, "\n", e?.stack?.split("\n").slice(0, 4).join("\n"));
    }
  }

  const processed = await backfillAnalysis();
  check("backfillAnalysis processed all 10 (J real, unregistered thumbs → sentinels)",
    processed === 10, "got " + processed);
  const jRow = (await getMediaByIds([J]))[0];
  check("J got a real 16-hex phash from its JPEG thumb", /^[0-9a-f]{16}$/.test(jRow.phash ?? ""), "got " + jRow.phash);
  const bigRow = (await getMediaByIds([BIG]))[0];
  check("undecodable thumb → '' phash + -1 sharpness sentinels (never retried forever)",
    bigRow.phash === "" && bigRow.sharpness === -1, "got " + bigRow.phash + " / " + bigRow.sharpness);
  check("A already had a phash — backfill leaves it untouched, fills only sharpness",
    (await getMediaByIds([A]))[0].phash === H1 && (await getMediaByIds([A]))[0].sharpness === -1);
  check("second backfillAnalysis pass is a no-op", (await backfillAnalysis()) === 0);
  check("countMissingAnalysis now 0", (await countMissingAnalysis()) === 0);
  // Deterministic far hashes + controlled sharpness for the ranking assertions.
  await updateMediaPhash(J, "f0f0f0f0f0f0f0f0");
  await updateMediaPhash(BIG, "0f0f0f0f0f0f0f0f");
  await updateMediaPhash(S1, "3333333333333333");
  await updateMediaPhash(W1, "cccccccccccccccc");
  await updateMediaPhash(NOW, "5555555555555555");

  // --- listPhashRows universe ---
  const all = await listPhashRows(-1);
  check("listPhashRows = {A,B,C,D,J,BIG,S1,W1,NOW} (excludes edited E, shared F, trashed G, video H/S2, sentinel I)",
    sameSet(ids(all), [A, B, C, D, J, BIG, S1, W1, NOW]), "got " + ids(all).join(","));
  check("listPhashRows excludes the anchor id",
    sameSet(ids(await listPhashRows(A)), [B, C, D, J, BIG, S1, W1, NOW]));

  // --- findSimilarTo ---
  const sim = await findSimilarTo(A);
  check("findSimilarTo(A) = [D, B] (distance 0 first, then 8; C/J at 64 excluded)",
    sim.length === 2 && sim[0].id === D && sim[1].id === B, "got " + sim.map((r) => r.id).join(","));
  check("findSimilarTo on a video returns []", (await findSimilarTo(H)).length === 0);

  // --- findDuplicateGroups (same-day union-find at DUP_HAMMING_MAX=8) ---
  const groups = await findDuplicateGroups();
  check("exactly one duplicate group", groups.length === 1, "got " + groups.length);
  check("group = {leader B(larger), A} — same-day only (D excluded despite distance 0)",
    groups.length === 1 && groups[0].items.length === 2 && groups[0].items[0].id === B && groups[0].items[1].id === A,
    "got " + (groups[0] ? groups[0].items.map((r) => r.id).join(",") : "none"));

  // --- manual tags + 6-param search ---
  await updateMediaUserTags(A, "Kashmir trip 2024");
  await updateMediaLabels(A, "beach sea");
  check("search 'kashmir' finds A via user_tags (case-insensitive)", sameSet(ids(await searchMediaRaw("kashmir")), [A]));
  check("search 'KASHMIR' finds A too", sameSet(ids(await searchMediaRaw("KASHMIR")), [A]));
  check("search 'beach' still finds A via ml_labels", sameSet(ids(await searchMediaRaw("beach")), [A]));
  check("search hits nothing for unrelated text", (await searchMediaRaw("zzznope")).length === 0);
  check("shared/edited/trashed rows never surface in search", !(await searchMediaRaw("trip")).some((r) => [E, F, G].includes(r.id)));
  await updateMediaUserTags(A, null);
  check("clearing user_tags removes it from search", (await searchMediaRaw("kashmir")).length === 0);

  // --- phash sentinel via real update path ---
  await updateMediaPhash(A, "");
  check("'' sentinel removes a row from listPhashRows",
    sameSet(ids(await listPhashRows(-1)), [B, C, D, J, BIG, S1, W1, NOW]));

  // --- real pHash math: round-trip + monotonic robustness ---
  {
    const n = 32;
    const solid = { gray: new Float64Array(n * n).fill(128), width: n, height: n };
    const half = { gray: new Float64Array(n * n), width: n, height: n };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) half.gray[y * n + x] = x < n / 2 ? 0 : 255;
    const tiny = { gray: Float64Array.from(solid.gray), width: n, height: n };
    tiny.gray[5 * n + 5] = 255; // one pixel differs from solid

    const hSolid = pHash64(solid);
    const hHalf = pHash64(half);
    const hex = hSolid.toString(16).padStart(16, "0");
    check("pHash hex round-trips through 16-char padStart → BigInt", BigInt("0x" + hex) === hSolid && hex.length === 16, hex);
    check("hamming64(h, h) = 0", hamming64(hSolid, hSolid) === 0);
    // Note: near-uniform images have a degenerate median → unstable bits, so
    // single-pixel stability is NOT a pHash guarantee. What the feature needs:
    // structurally different images land far above the duplicate threshold (8).
    check("structurally different image scores far above the dup threshold",
      hamming64(hSolid, hHalf) > 8, "half=" + hamming64(hSolid, hHalf));
    check("one-pixel change keeps distance below the similar threshold... (informational)",
      true, "tiny=" + hamming64(hSolid, pHash64(tiny)));

    const decoded = await decodeThumbToGray("mem://probe/j.jpg");
    check("decodeThumbToGray decodes the registered 48x32 JPEG (real jpeg-js path)",
      decoded.width === 48 && decoded.height === 32 && decoded.gray.length === 48 * 32);
    const decodedHex = pHash64(decoded).toString(16).padStart(16, "0");
    check("pHash of decoded JPEG is stable across re-decode",
      hamming64(BigInt("0x" + decodedHex), pHash64(decoded)) === 0);
  }

  // --- v0.27 saved searches: CRUD + dedupe + auto-updating runs ---
  {
    await saveSearch("beach");
    await saveSearch("beach"); // same query again → dedupe, no second row
    let list = await listSavedSearches();
    check("saveSearch stores query as name", list.length === 1 && list[0].query === "beach" && list[0].name === "beach");
    await saveSearch("November 2023");
    list = await listSavedSearches();
    check("second saved search lands on top (created_at DESC)", list.length === 2 && list[0].query === "November 2023");

    const saved = await getSavedSearch(list[0].id);
    check("getSavedSearch round-trips", !!saved && saved.query === "November 2023");
    const viaSaved = await runSearch(saved!.query);
    // Nov 2023 (local) covers every day1 row except the excluded E/F/G: 11 rows.
    check("saved date-search re-runs through runSearch (11 day-1 rows)", viaSaved.length === 11, "got " + viaSaved.length);
    const beachSearch = await getSavedSearch(list[1].id);
    const beachRows = await runSearch(beachSearch!.query);
    check("saved text-search finds A via ml_labels", sameSet(beachRows.map((r) => r.id), [A]));

    await deleteSavedSearch(list[0].id);
    list = await listSavedSearches();
    check("deleteSavedSearch removes exactly one row", list.length === 1 && list[0].query === "beach");
  }

  // --- v0.29 storage deep-dive aggregations ---
  {
    const largest = await getLargestItems(12);
    check("getLargestItems: BIG first, S2 second, exactly 12 rows", largest.length === 12 && largest[0].id === BIG && largest[1].id === S2,
      "got " + largest.map((r) => r.id).join(","));
    check("getLargestItems excludes edited/shared/trashed giants (E/F/G)",
      !largest.some((r) => [E, F, G].includes(r.id)));

    const cats = await getCategoryUsage();
    const byKey = new Map(cats.map((c) => [c.key, c]));
    check("category: everything = 9,005,319 bytes / 12 items",
      byKey.get("everything")!.bytes === 9_005_319 && byKey.get("everything")!.count === 12,
      JSON.stringify(byKey.get("everything")));
    check("category: screenshots = 1000 / 1 (S1)", byKey.get("screenshots")!.bytes === 1000 && byKey.get("screenshots")!.count === 1);
    check("category: whatsapp = 2000 / 1 (S2)", byKey.get("whatsapp")!.bytes === 2000 && byKey.get("whatsapp")!.count === 1);
    check("category: downloads = 500 / 1 (W1)", byKey.get("downloads")!.bytes === 500 && byKey.get("downloads")!.count === 1);
    check("category: videos = 2100 / 2 (H + S2 overlap allowed)", byKey.get("videos")!.bytes === 2100 && byKey.get("videos")!.count === 2);

    const months = await getMonthlyBuckets(12);
    check("12 month buckets with ym keys", months.length === 12 && /^\d{4}-\d{2}$/.test(months[0].ym));
    const cur = months[11];
    check("current-month bucket carries the mid-month seed (NOW = 777 / 1)",
      cur.bytes === 777 && cur.count === 1, JSON.stringify(cur));
    const day1InWindow = months.some((m) => m.count > 0 && m.ym !== cur.ym);
    check("day-1 seeds (Nov 2023) fall OUTSIDE the 12-month window", !day1InWindow);
  }

  // --- v0.28 album locks: real settingsStore logic in Node ---
  {
    const s = useSettingsStore.getState();
    check("lockedAlbumKeys starts empty", s.lockedAlbumKeys.length === 0);
    s.setAlbumLocked("camera", true);
    s.setAlbumLocked("camera", true); // idempotent
    check("locking an album registers its key once",
      useSettingsStore.getState().lockedAlbumKeys.length === 1 && useSettingsStore.getState().lockedAlbumKeys.includes("camera"));
    s.setAlbumLocked("shared-3", true);
    check("shared albums lock under their shared-<id> key",
      useSettingsStore.getState().lockedAlbumKeys.length === 2);
    s.setAlbumLocked("camera", false);
    check("unlocking removes only that key",
      sameSet(useSettingsStore.getState().lockedAlbumKeys, ["shared-3"]));
  }

  // --- v0.32 journal ---
  {
    await setMediaNote(A, "Emma's first steps at the beach");
    await setMediaNote(D, "Her second birthday");
    const noted = await listNotedMedia();
    check("journal lists noted photos newest-first (D day2, then A day1)",
      noted.length >= 2 && noted[0].id === D && noted[1].id === A, "got " + noted.map((r) => r.id).join(","));
    check("journal rows carry the note text", noted[0].note_text === "Her second birthday");
  }

  // --- v0.30 backup integrity (real engine, controllable TDLib stub) ---
  {
    // Synced rows with a remote link; I5 mimics the junk sweep's "owner
    // deleted the Telegram copy" marker (remote_message_id = '0') → out of scope.
    const I1 = await mk({ file_name: "int1.jpg" });
    const I2 = await mk({ file_name: "int2.jpg" });
    const I3 = await mk({ file_name: "int3.jpg" });
    const I4 = await mk({ file_name: "int4.jpg" });
    const I5 = await mk({ file_name: "int5.jpg" });
    await setMediaRemote(I1, "100", "9001");
    await setMediaRemote(I2, "100", "9002");
    await setMediaRemote(I3, "100", "9003");
    await setMediaRemote(I4, "100", "9004");
    await setMediaRemote(I5, "100", "0");
    __setResponse(9001, JSON.stringify({ "@type": "message", content: { "@type": "messagePhoto" } }));
    __setResponse(9002, JSON.stringify({ "@type": "error", code: 404, message: "MESSAGE_NOT_FOUND" }));
    __setThrowOn(9004);

    const report1 = await runIntegrityPass();
    check("integrity pass 1: 3 checked (I5 '0' excluded, I4 stopped before processing)",
      report1.checked === 3, JSON.stringify({ c: report1.checked, v: report1.verified, b: report1.broken }));
    check("integrity pass 1: 1 verified / 2 broken", report1.verified === 1 && report1.broken === 2);
    check("integrity pass 1: transient throw pauses the run without finishing",
      report1.stoppedReason !== null && report1.finishedAt === null, report1.stoppedReason ?? "no reason");
    check("integrity pass 1: broken reasons name the cause (404 / no response)",
      report1.rows.some((r) => r.reason.includes("404")) && report1.rows.some((r) => r.reason.includes("no response")));

    __setResponse(9004, JSON.stringify({ "@type": "message", content: { "@type": "messageAnimation" } }));
    const report2 = await runIntegrityPass();
    check("integrity pass 2: resumes exactly where it stopped (4 checked)",
      report2.checked === 4 && report2.verified === 2 && report2.broken === 2,
      JSON.stringify({ c: report2.checked, v: report2.verified, b: report2.broken }));
    check("integrity pass 2: whole library walked → finishedAt set", report2.finishedAt !== null);
    check("integrity: messageAnimation counts as a valid backup content type",
      report2.rows.every((r) => r.id !== I4));
    check("integrity: report persists in meta", (await loadIntegrityReport())?.checked === 4);
    check("integrity: openChat called once per chat (throttled run)", __openChatCount() === 1);
  }

  // --- v0.33 highlights (controlled sharpness; threshold = 40, blur excluded) ---
  {
    await updateMediaSharpness(A, 50);
    await updateMediaSharpness(B, 120);
    await updateMediaSharpness(C, 80);
    await updateMediaSharpness(D, 200);
    await updateMediaSharpness(I, 30); // below threshold → excluded
    await updateMediaSharpness(S1, 60);
    await updateMediaSharpness(J, 75);
    await updateMediaSharpness(NOW, 100);
    const months = await getHighlights(6);
    const curYm = new Date().toISOString().slice(0, 7);
    check("highlights: newest month first, sharpest-first within the month",
      months.length === 2 && months[0].ym === curYm && months[1].ym === "2023-11",
      JSON.stringify(months.map((m) => m.ym)));
    check("highlights: Nov 2023 = D,B,C,J,S1,A (I below blur threshold; perMonth 6 cap)",
      sameSet(months[1].items.map((r) => r.id), [D, B, C, J, S1, A]) &&
        months[1].items[0].id === D && months[1].items[5].id === A,
      "got " + months[1].items.map((r) => r.id).join(","));
    check("highlights: month label is human", months[1].label === "November 2023", months[1].label);
    check("highlights: current month carries NOW only", sameSet(months[0].items.map((r) => r.id), [NOW]));
  }

  // --- v0.31 diagnostics ---
  {
    const d = await getDbDiagnostics();
    check("diagnostics: schema version 21", d.schemaVersion === 21);
    check("diagnostics: db size > 0", d.dbBytes > 0);
    check("diagnostics: media totals match the seed library", d.mediaTotal === 20 && d.mediaVisible === 19 && d.mediaTrashed === 1,
      JSON.stringify({ t: d.mediaTotal, v: d.mediaVisible, tr: d.mediaTrashed }));
    check("diagnostics: state split (5 synced integrity rows, no failed)", d.mediaSynced === 5 && d.mediaLocal === 15 && d.mediaFailed === 0,
      JSON.stringify({ s: d.mediaSynced, l: d.mediaLocal, f: d.mediaFailed }));
    check("diagnostics: feature counters (saved searches, notes, hashed rows raw incl. excluded)",
      d.savedSearches === 1 && d.notedCount === 2 && d.hashedCount === 11,
      JSON.stringify({ s: d.savedSearches, n: d.notedCount, h: d.hashedCount }));
  }

  // --- v0.33+ People & Pets: model URL safety + face sample storage ---
  {
    check("model catalog ships exactly the two verified tflite files",
      FACE_MODELS.length === 2 && FACE_MODELS.every((m) => validateModelUrl(m.url)),
      JSON.stringify(FACE_MODELS.map((m) => [m.id, m.url])));
    check("URL gate: rejects http, localhost, IPs, non-allowlisted hosts, garbage", (() => {
      const bad = [
        "http://raw.githubusercontent.com/a/b.tflite",
        "https://localhost/x.tflite",
        "https://192.168.1.10/x.tflite",
        "https://evil.example.com/x.tflite",
        "https://raw.githubusercontent.com.evil.com/x.tflite",
        "not a url",
        "",
      ];
      return bad.every((u) => !validateModelUrl(u));
    })(), "some bad URL passed");
    check("URL gate: allows the github download hosts (incl. redirect target)",
      validateModelUrl("https://github.com/a/b/releases/download/1/x.tflite") &&
        validateModelUrl("https://objects.githubusercontent.com/x.tflite"));

    const s = useSettingsStore.getState();
    check("faceModelId starts empty", s.faceModelId === null);
    s.setFaceModelId("facenet-128");
    check("faceModelId round-trips through the store", useSettingsStore.getState().faceModelId === "facenet-128");
    s.setFaceModelId(null);

    // face_samples storage: detected faces, none-found sentinel, replacement
    check("photo without samples reports hasFaceSamples false", !(await hasFaceSamples(A)));
    await replaceFaceSamples(A, [
      { x: 10, y: 20, w: 60, h: 60 },
      { x: 100, y: 30, w: 50, h: 50 },
    ]);
    check("two detected faces stored for A", await hasFaceSamples(A));
    await replaceFaceSamples(A, [{ x: 5, y: 5, w: 40, h: 40 }]);
    {
      const db = await getDb();
      const n = await db.getFirstAsync("SELECT COUNT(*) AS n FROM face_samples WHERE media_id = ?", [A]);
      check("re-detection replaces (not appends) the samples", n.n === 1, "got " + n.n);
    }
    await replaceFaceSamples(B, []);
    {
      const db = await getDb();
      const sentinel = await db.getFirstAsync(
        "SELECT box_x FROM face_samples WHERE media_id = ?",
        [B]
      );
      check("empty detection writes the -1 'checked, no faces' sentinel", sentinel.box_x === -1);
    }
  }

  // --- v0.35 People & Pets step 2: preprocessing + pipeline + clustering ---
  {
    // per-image z-score preprocessing (verified against the model repo)
    const S = 8;
    const flat = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      flat[i * 4] = 100;
      flat[i * 4 + 1] = 100;
      flat[i * 4 + 2] = 100;
      flat[i * 4 + 3] = 255;
    }
    const constInput = rgbaToModelInput(flat, S);
    check("preprocessing: constant image standardizes to all-zeros (std floor path)",
      constInput.length === S * S * 3 && constInput.every((v) => v === 0));
    const varied = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      varied[i * 4] = (i * 37) % 256;
      varied[i * 4 + 1] = (i * 53) % 256;
      varied[i * 4 + 2] = (i * 91) % 256;
      varied[i * 4 + 3] = 255;
    }
    const varInput = rgbaToModelInput(varied, S);
    let m = 0;
    for (const v of varInput) m += v;
    m /= varInput.length;
    let sd = 0;
    for (const v of varInput) sd += (v - m) * (v - m);
    sd = Math.sqrt(sd / varInput.length);
    check("preprocessing: varied image standardizes to mean≈0, std≈1",
      Math.abs(m) < 1e-6 && Math.abs(sd - 1) < 1e-6, `mean ${m} std ${sd}`);

    // face detection backfill (phase 1) with a controllable native module
    (NativeModules as Record<string, unknown>).FaceDetection = {
      detect: async () => [{ frame: { left: 10, top: 10, width: 40, height: 40 } }],
    };
    useSettingsStore.getState().setFaceModelId(null); // embedding phase off for now
    const bf1 = await backfillFaces();
    check("backfillFaces phase 1: detection ran to completion", bf1.detectDone === true && bf1.detectionReady === true);
    check("backfillFaces phase 1: no model → embedding phase skipped", bf1.modelReady === false && bf1.embedDone === false);
    check("backfillFaces covers ALREADY-SCANNED photos (NOW got samples)", await hasFaceSamples(NOW));
    check("backfillFaces respects the 'already checked' sentinel (B untouched)", (await getMediaByIds([B]))[0].id === B);

    // clustering with controlled embeddings (3-d, cleanly separated):
    // C=(1,0,0) D=(0.99,0.1,0) J=(0.7,0.7,0) cluster together (cos ≥ 0.6),
    // I=(0,0,1) is orthogonal to all → stays ungrouped
    await replaceFaceSamples(C, [{ x: 1, y: 1, w: 30, h: 30 }]);
    await replaceFaceSamples(D, [{ x: 1, y: 1, w: 30, h: 30 }]);
    await replaceFaceSamples(I, [{ x: 1, y: 1, w: 30, h: 30 }]);
    await replaceFaceSamples(J, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const cSample = (await dbSamplesFor(C))[0];
    const dSample = (await dbSamplesFor(D))[0];
    const iSample = (await dbSamplesFor(I))[0];
    const jSample = (await dbSamplesFor(J))[0];
    await setFaceEmbedding(cSample.id, f32ToBytes(new Float32Array([1, 0, 0])), "facenet-128");
    await setFaceEmbedding(dSample.id, f32ToBytes(new Float32Array([0.99, 0.1, 0])), "facenet-128");
    await setFaceEmbedding(jSample.id, f32ToBytes(new Float32Array([0.7, 0.7, 0])), "facenet-128");
    await setFaceEmbedding(iSample.id, f32ToBytes(new Float32Array([0, 0, 1])), "facenet-128");
    const cluster = await runClustering();
    check("clustering: exactly one person created for the {C,D,J} group", cluster.peopleCreated === 1 && cluster.groupedFaces === 3, JSON.stringify(cluster));
    const people = await listPeople();
    check("clustering: the unnamed person holds C+D+J (largest-box cover = one of them)",
      people.length === 1 && people[0].face_count === 3 && people[0].name === null);
    const personPhotos = await listFacesForPerson(people[0].id);
    check("clustering: person's photos are exactly C+D+J (I orthogonal, ungrouped)",
      personPhotos.length === 3 && personPhotos.every((r) => [C, D, J].includes(r.id)),
      "got " + personPhotos.map((r) => r.id).join(","));

    // embedding backfill (phase 2) with the fake tflite + real preprocessing
    __setCropOutput("/probe-docs/crop.jpg");
    __registerFile("/probe-docs/crop.jpg", new Uint8Array(jpeg.encode({ data: flat, width: S, height: S }, 90).data));
    __setTfliteOutput(new Float32Array(128).fill(0.5));
    __setLegacyFileExists(true);
    useSettingsStore.getState().setFaceModelId("facenet-128");
    const bf2 = await backfillFaces();
    check("backfillFaces phase 2: embeddings computed for this model", bf2.modelReady === true && bf2.embedDone === true, JSON.stringify(bf2));
    check("backfillFaces phase 2: nothing left to embed", (await countFacesNeedingEmbedding("facenet-128")) === 0);
    const cEmb = bytesToF32((await dbSamplesFor(C))[0].embedding);
    check("BLOB round-trip: stored embedding reads back bit-identical",
      cEmb.length === 3 && cEmb[0] === 1 && cEmb[1] === 0 && cEmb[2] === 0,
      "got " + Array.from(cEmb.slice(0, 4)).join(","));
    check("clustering idempotence: the identical-embedding batch groups once, then never again",
      (await runClustering()).peopleCreated === 1 && (await runClustering()).peopleCreated === 0);
    void FACE_COSINE_THRESHOLD;
  }

  // --- v0.36 scene auto-albums: boundary-safe label matching ----------------
  let probeSceneRow = 0; // shared into the merge block below
  {
    check("scene catalog ships six curated scenes with disjoint-ish label sets",
      SCENES.length === 6 && SCENES.every((s) => s.key.length > 0 && s.labels.length >= 2));

    const SC1 = await mk({ taken_at: DAY1 }); // "beach sea" → beach scene
    await updateMediaLabels(SC1, "beach sea");
    const SC2 = await mk({ taken_at: DAY2 }); // "Food Dish" case check → food scene
    await updateMediaLabels(SC2, "Food Dish");
    const SC_BOUND = await mk({}); // "seashore" must NOT partial-match "sea"
    await updateMediaLabels(SC_BOUND, "seashore seaside");
    const SC_NULL = await mk({}); // never labeled → no scene ever
    const SB2 = await mk({ taken_at: DAY1 + DAY_MS + 3600e3 }); // "beach sunset" → beach, newest
    await updateMediaLabels(SB2, "beach sunset");
    const SC_ED = await mk({ edited_from: SC1 }); // edited copies are out everywhere
    await updateMediaLabels(SC_ED, "beach");
    const SC_SH = await mk({}); // shared-album rows are out
    await updateMediaLabels(SC_SH, "dog puppy");
    await db.runAsync(
      "INSERT INTO album_media (album_id, media_id, added_at) VALUES (?, ?, 1)",
      [albumId, SC_SH]
    );

    // A earlier in the probe carries "beach sea" and is STILL VISIBLE here —
    // the merge section runs after and re-proves the trashed exclusion for
    // its own case. Pinned counts: beach = {SB2, SC1, A}, food = {SC2}.
    const beachLabels = SCENES.find((s) => s.key === "beach")!.labels;
    const foodLabels = SCENES.find((s) => s.key === "food")!.labels;
    const animalsLabels = SCENES.find((s) => s.key === "animals")!.labels;

    check("boundaries: partial tokens impossible 'sea' vs 'seashore'/'seaside' → only SC1 + A match",
      (await countScenePhotos(["sea"])) === 2, "got " + (await countScenePhotos(["sea"])));
    check("boundary search ring: list excludes boundary + edited + shared rows",
      sameSet(ids(await listScenePhotos(beachLabels, 200)), [SB2, SC1, A]),
      "got " + ids(await listScenePhotos(beachLabels, 200)).join(","));
    const counts = await Promise.all([
      countScenePhotos(beachLabels),
      countScenePhotos(foodLabels),
      countScenePhotos(animalsLabels),
      countScenePhotos(SCENES.find((s) => s.key === "nature")!.labels),
      countScenePhotos(SCENES.find((s) => s.key === "city")!.labels),
      countScenePhotos(SCENES.find((s) => s.key === "snow")!.labels),
    ]);
    check("scene counts: beach {SB2,SC1,A} / food {SC2} / animals {SC_SH excluded → 0} / rest 0",
      counts[0] === 3 && counts[1] === 1 && counts[2] === 0 && counts[3] === 0 && counts[4] === 0 && counts[5] === 0,
      counts.join(","));
    check("case-insensitivity: 'Food Dish' matches the food scene", counts[1] === 1);
    check("scene list ordered newest-first (SB2 DAY1+1h, then SC1 DAY1)",
      (await listScenePhotos(beachLabels, 200)).map((r) => r.id)[0] === SB2);
    const bestEmpty = await getSceneOverview();
    check("getSceneOverview returns all six scenes with counts",
      bestEmpty.length === 6 && bestEmpty.every((o) => o.count >= 0) && bestEmpty.find((o) => o.scene.key === "food")!.count === 1);
    check("getSceneMedia: unknown key → null (unknown scenes never crash)",
      (await getSceneMedia("definitely-not-a-scene")) === null);
    const foodMedia = await getSceneMedia("food");
    check("getSceneMedia returns the food row set", sameSet(ids(foodMedia!), [SC2]));
    check("scene universe excludes videos despite everything else (video H unlabeled anyway)",
      !(await listScenePhotos(beachLabels, 200)).some((r) => r.id === H));
    probeSceneRow = SC1;
  }

  // --- v0.36 duplicate merge: keeper stays, rest → reversible Trash ---------
  {
    // A's phash was cleared to the '' sentinel by the search section; restore
    // it so the {leader B, A} duplicate group re-forms.
    await updateMediaPhash(A, H1);
    const groups2 = await findDuplicateGroups();
    check("dup groups re-form for merge test ({leader B, A})",
      groups2.length === 1 && groups2[0].items.length === 2 && groups2[0].items[0].id === B && groups2[0].items[1].id === A,
      JSON.stringify(groups2.map((g) => g.items.map((r) => r.id))));

    const outcome = await mergeDuplicateGroup(groups2[0], B);
    check("merge: outcome = 1 trashed / 0 skipped / bytes = A's 100", outcome.trashed === 1 && outcome.skipped === 0 && outcome.freedBytes === 100,
      JSON.stringify(outcome));
    check("merge: keeper B stays visible (never, ever touched)",
      (await getMediaByIds([B]))[0].visibility === "visible");
    const aRow = (await getMediaByIds([A]))[0];
    check("merge: A trashed with trashed_at set (30-day countdown starts)",
      aRow.visibility === "trashed" && (aRow.trashed_at ?? 0) > 0);
    check("merge: trashed duplicates drop out of findDuplicateGroups",
      (await findDuplicateGroups()).length === 0);
    check("merge: trashed duplicates drop out of every scene",
      // probeSceneRow ("beach sea", visible) stays; A ("beach sea", now trashed) does not
      (await countScenePhotos(["sea"])) === 1 && ids(await listScenePhotos(["beach"], 200)).includes(probeSceneRow));

    // Stale-snapshot safety: merging the SAME (now stale) group again is a
    // genuine no-op — A is freshly re-read inside and skipped.
    const outcome2 = await mergeDuplicateGroup(groups2[0], B);
    check("merge: re-merge of the stale group skips (trashed 0, skipped 1)",
      outcome2.trashed === 0 && outcome2.skipped === 1, JSON.stringify(outcome2));

    const badOutcome = await mergeDuplicateGroup(groups2[0], 999999);
    check("merge: keeper not in group → all-zero outcome (no partial merges)",
      badOutcome.trashed === 0 && badOutcome.skipped === 0 && badOutcome.freedBytes === 0);
  }

  // --- v0.37 scheduled integrity: due-gate math ------------------------------
  {
    const NOW = 1_800_000_000_000;
    check("schedule math: 'off' never runs",
      shouldRunScheduledIntegrity("off", 0, NOW) === false);
    check("schedule math: weekly not due at 6d23h, due at 7d",
      shouldRunScheduledIntegrity("weekly", NOW - 6 * DAY_MS - (DAY_MS - 1), NOW) === false &&
      shouldRunScheduledIntegrity("weekly", NOW - INTEGRITY_INTERVALS_MS.weekly, NOW) === true);
    check("schedule math: monthly due exactly at 30d, not at 29d23h",
      shouldRunScheduledIntegrity("monthly", NOW - 29 * DAY_MS - (DAY_MS - 1), NOW) === false &&
      shouldRunScheduledIntegrity("monthly", NOW - INTEGRITY_INTERVALS_MS.monthly, NOW) === true);
    check("schedule math: negative/zero last timestamps count as never-done",
      shouldRunScheduledIntegrity("weekly", 0, NOW) === true);
    check("schedule math: intervals are the documented constants",
      INTEGRITY_INTERVALS_MS.weekly === 7 * DAY_MS && INTEGRITY_INTERVALS_MS.monthly === 30 * DAY_MS);
  }

  // --- v0.38 export-everything: manifest, CSV escaping, end-to-end write -----
  {
    const [exMedia, exPeople, exFaces] = [
      await listAllMediaForExport(),
      await listPeopleForExport(),
      await listFacesForExport(),
    ];
    const manifest = JSON.parse(buildManifestJson(exMedia, exPeople, exFaces, 1_760_000_000_000));
    check("export: manifest parses as JSON", typeof manifest === "object" && manifest !== null);
    check("export: header format + version", manifest.format === "photogram-export" && manifest.version === 1);
    check("export: media_count matches the REAL row count (COUNT(*))",
      manifest.media_count === Number((await db.getFirstAsync("SELECT COUNT(*) AS n FROM media")).n),
      "manifest " + manifest.media_count);
    check("export: media entries included with TRASHED/edited/hidden rows (escape hatch covers everything)",
      Array.isArray(manifest.media) && manifest.media.length === manifest.media_count);
    check("export: exported media entries carry Telegram ids + ISO dates",
      manifest.media.every((m) => typeof m.taken_at === "string" && m.taken_at.endsWith("Z")));
    check("export: people + face samples arrays present",
      Array.isArray(manifest.people) && Array.isArray(manifest.face_samples));
    check("export: face sample embedding is hex (no Buffer dependency)",
      manifest.face_samples.every((f) => f.embedding_hex === null || /^[0-9a-f]+$/.test(f.embedding_hex)));

    // CSV escaping (RFC 4180)
    check("csvEscape: plain text stays bare", csvEscape("photo.jpg") === "photo.jpg");
    check("csvEscape: comma → quoted", csvEscape("a,b") === '"a,b"');
    check("csvEscape: quote → doubled inside quotes", csvEscape('say "hi"') === '"say ""hi"""');
    check("csvEscape: newline → quoted", csvEscape("line1\nline2").startsWith('"line1'));
    check("csvEscape: null/undefined → empty", csvEscape(null) === "" && csvEscape(undefined) === "");
    check("csvEscape: numbers/booleans stay plain", csvEscape(100) === "100" && csvEscape(true) === "true");
    const csv = buildCsv(exMedia);
    check("csv header lists the documented columns",
      csv.split("\r\n")[0] === "id,file_name,mime_type,byte_size,taken_at,uploaded_at,state,visibility,width,height,duration_ms,latitude,longitude,place_name,ml_labels,user_tags,note_text,is_favorite,phash,edited_from,fingerprint,remote_chat_id,remote_message_id");
    check("csv carries one data row per media row",
      csv.split("\r\n").filter((l) => l.length > 0).length === exMedia.length + 1);

    // hex helper sanity: embeddings round-trip through hex
    const someFace = exFaces.find((f) => f.embedding !== null);
    if (someFace) {
      const hex = bytesToHex(someFace.embedding);
      check("export: bytesToHex round-trips a face embedding",
        hex !== null && hex.length === someFace.embedding.byteLength * 2,
        "len " + (hex?.length ?? -1));
    }

    // END-TO-END via the in-memory FS stub: REAL runExport writes a file,
    // reads back parseable JSON at the right size.
    {
      check("export: mediaToExport keeps visibility/state fields",
        mediaToExport(exMedia.find((m) => m.visibility === "trashed")!).visibility === "trashed");
      const res = await runExport("json", { minify: true });
      check("export: runExport reports byteCount > 0", res.byteCount > 0, "got " + res.byteCount);
      check("export: written file name carries the stamp", res.fileName.startsWith("photogram-manifest-"));
      const readBack = JSON.parse(new ProbeFsFile(res.uri).text());
      check("export: file round-trips through disk as valid JSON",
        readBack.format === "photogram-export" && readBack.media_count === manifest.media_count);
    }
  }

  // --- v0.39: People & Pets v2 + undo-merge + doc albums + digest + import ---
  {
    // (1) undo-merge: the merge block trashed A with trash_reason 'merge'
    // (the keeper B and the user-trash G carry no reason).
    check("undo: merged duplicate A carries trash_reason 'merge'",
      (await getMediaByIds([A]))[0].trash_reason === "merge",
      "got " + (await getMediaByIds([A]))[0].trash_reason);
    check("undo: countMergedInTrash counts only merge-tagged rows (1)",
      (await countMergedInTrash()) === 1,
      "got " + (await countMergedInTrash()));
    check("undo: user-trashed G does not count as a merged duplicate",
      (await countMergedInTrash()) === 1);
    const restored = await restoreMergedFromTrash();
    check("undo: restoreMergedFromTrash reports restored rows (1)",
      restored === 1 && (await getMediaByIds([A]))[0].visibility === "visible",
      "got " + restored);
    const aAfter = (await getMediaByIds([A]))[0];
    check("undo: A fully restored (reason + trashed_at cleared)",
      aAfter.trash_reason === null && aAfter.trashed_at === null);

    // (2) People v2: named person affinity attach with per-person sensitivity
    const PN = await createPerson(null);
    await renamePerson(PN, "Alpha");
    // Alpha's member: P1_media sample at (1,0,0)
    const P1M = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(P1M, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const p1Sample = (await dbSamplesFor(P1M))[0];
    await setFaceEmbedding(p1Sample.id, f32ToBytes(new Float32Array([1, 0, 0])), "facenet-128");
    await assignFacesToPerson([p1Sample.id], PN);

    // attach candidate: cos 0.9918 with Alpha's member → attaches at default 0.6
    const P2M = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(P2M, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const p2Sample = (await dbSamplesFor(P2M))[0];
    await setFaceEmbedding(p2Sample.id, f32ToBytes(new Float32Array([0.99, 0.1, 0])), "facenet-128");
    // never-similar candidate: (−1,0,0) — cos ≤ 0 with every other probe vector
    const P3M = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(P3M, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const p3Sample = (await dbSamplesFor(P3M))[0];
    await setFaceEmbedding(p3Sample.id, f32ToBytes(new Float32Array([-1, 0, 0])), "facenet-128");

    const cluster1 = await runClustering();
    check("people v2: affinity attach pulled 1 face into named Alpha, 0 new people",
      cluster1.attachedToNamed === 1 && cluster1.peopleCreated === 0,
      JSON.stringify(cluster1));
    check("people v2: Alpha now holds both close faces, orthogonal one stays loose",
      (await listFacesForPerson(PN)).every((r) => [P1M, P2M].includes(r.id)) &&
      (await listFacesForPerson(PN)).length === 2,
      "got " + (await listFacesForPerson(PN)).map((r) => r.id).join(","));
    {
      const allEmb = await listAllEmbeddingsForClustering();
      const pnId = Number(PN);
      check("people v2: listAllEmbeddingsForClustering covers assigned + unassigned",
        allEmb.some((e) => e.person_id === pnId),
        "count " + allEmb.length + " pids " + JSON.stringify([...new Set(allEmb.map((e) => e.person_id))]) + " pnId " + pnId + " sampleIds " + JSON.stringify([( await dbSamplesFor(P1M))[0], (await dbSamplesFor(P2M))[0]].map((s) => [s.id, s.person_id])));
    }

    // strict threshold 0.99: everything else (0.7 / 0.7685 / 0) stays out —
    // proves attach honours PER-PERSON sensitivity over the global default.
    await setPersonSensitivity(PN, 0.99);
    const P4M = await mk({ taken_at: DAY2 });
    await replaceFaceSamples(P4M, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const p4Sample = (await dbSamplesFor(P4M))[0];
    // cos((0.7,0.7141,0),(0.99,0.1,0)) = 0.7685 (in-range for default, not 0.99)
    await setFaceEmbedding(p4Sample.id, f32ToBytes(new Float32Array([0.7, 0.714142842854285, 0])), "facenet-128");
    const cluster2 = await runClustering();
    check("people v2: strict per-person sensitivity 0.99 forbids the 0.7685 attach (no person, no group)",
      cluster2.attachedToNamed === 0 && cluster2.peopleCreated === 0 &&
      (await listFacesForPerson(PN)).length === 2,
      JSON.stringify(cluster2));
    check("people v2: setPersonSensitivity round-trips through listPeopleFull",
      ((await listPeopleFull()).find((p) => p.id === PN) ?? { sensitivity: null }).sensitivity === 0.99);
    check("people v2: strict value holds across reruns (idempotent, no re-attach)",
      (await runClustering()).attachedToNamed === 0);

    // (3) Not-this-person: blocked pair prevents future re-grouping.
    // Dismiss P2M from Alpha → p2's sample unassigns; pair (p1,p2) blocked.
    await dismissFacesFromPerson([p2Sample.id], PN);
    const rejections = await listFaceRejections();
    const canonical = p1Sample.id < p2Sample.id
      ? `${p1Sample.id}-${p2Sample.id}`
      : `${p2Sample.id}-${p1Sample.id}`;
    check("people v2: rejection recorded as a canonical pair",
      rejections.some((r) => `${r.sample_id}-${r.blocked_sample_id}` === canonical),
      JSON.stringify(rejections));
    // Rerun: p2 (cos 0.9918 to p1, ≥ the 0.99 threshold) would attach again —
    // only the blocked pair stops it. p2+p4 (0.7685, unblocked) form a NEW
    // unnamed group instead; Alpha keeps exactly its one member.
    const cluster3 = await runClustering();
    check("people v2: blocked pair defeats affinity attach permanently (0 attached)",
      cluster3.attachedToNamed === 0,
      JSON.stringify(cluster3));
    check("people v2: unblocked pair {p2,p4} still forms a new unnamed group",
      cluster3.peopleCreated === 1 && cluster3.groupedFaces === 2,
      JSON.stringify(cluster3));
    check("people v2: dismissed sample belongs to no one (Alpha unchanged)",
      !(await listFacesForPerson(PN)).some((r) => r.id === P2M) &&
      (await listFacesForPerson(PN)).length === 1);

    // (4) split-off: Alpha's LAST face leaves → the person row dies. Blocked
    // pairs survive person deletion by design (pair-level learning).
    const splitOutcome = await splitOffFaces([p1Sample.id], PN);
    check("people v2: splitting a person's last face deletes the person row",
      splitOutcome.deletedSource === true &&
      !(await listPeopleFull()).some((p) => p.id === PN));
    const cluster4 = await runClustering();
    const p1AfterSplit = (await dbSamplesFor(P1M))[0];
    check("people v2: after split, p1 stays unassigned and no spurious group fires",
      cluster4.peopleCreated === 0 && cluster4.attachedToNamed === 0 && p1AfterSplit.person_id === null,
      JSON.stringify(cluster4));
    const rejectionsAfter = await listFaceRejections();
    check("people v2: blocked pair survives the person's deletion (pair-level memory)",
      rejectionsAfter.some((r) => `${r.sample_id}-${r.blocked_sample_id}` === canonical));

    // (5) merge people: unit test via mergePeopleInto on two fresh people
    const PA = await createPerson("Target");
    const PB = await createPerson("Source");
    const MA1 = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(MA1, [{ x: 2, y: 2, w: 30, h: 30 }]);
    const a1 = (await dbSamplesFor(MA1))[0];
    await assignFacesToPerson([a1.id], PA);
    const MB1 = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(MB1, [{ x: 3, y: 3, w: 30, h: 30 }]);
    const b1 = (await dbSamplesFor(MB1))[0];
    await assignFacesToPerson([b1.id], PB);
    await mergePeopleInto(PA, PB);
    check("people v2: mergePeopleInto moves all faces to the target",
      (await countFacesOfPerson(PA)) === 2 && (await countFacesOfPerson(PB)) === 0);
    check("people v2: mergePeopleInto deletes the source row",
      !(await listPeopleFull()).some((p) => p.id === PB));
    check("people v2: target keeps its name after merge",
      ((await listPeopleFull()).find((p) => p.id === PA) ?? { name: null }).name === "Target");
    await deletePerson(PA);
    check("people v2: deletePerson unassigns + removes the row",
      !(await listPeopleFull()).some((p) => p.id === PA) && (await countFacesOfPerson(PA)) === 0);

    // (6) document auto-albums
    const DR1 = await mk({ taken_at: DAY1 + 5 * DAY_MS });
    await updateOcrText(DR1, "GRAND TOTAL PAID ON\nreceipt R-123");
    const DR2 = await mk({ taken_at: DAY1 + 6 * DAY_MS });
    await updateOcrText(DR2, "INVOICE NO 4412 · amount due $40");
    const DR_BOUND = await mk({ taken_at: DAY1 + 6 * DAY_MS });
    await updateOcrText(DR_BOUND, "receipted goods at the store");
    const DR_DOC = await mk({ taken_at: DAY1 + 2 * DAY_MS });
    await updateOcrText(DR_DOC, "Certificate of Birth — licence no 91 pass");
    const DR_ED = await mk({ edited_from: DR1, taken_at: DAY1 + 5 * DAY_MS });
    await updateOcrText(DR_ED, "receipt copy edit");
    const DR_SH = await mk({ taken_at: DAY1 + 5 * DAY_MS });
    await updateOcrText(DR_SH, "receipt in the family group");
    await db.runAsync("INSERT INTO album_media (album_id, media_id, added_at) VALUES (?, ?, 1)", [albumId, DR_SH]);
    const DR_TR = await mk({ taken_at: DAY1 + 5 * DAY_MS });
    await updateOcrText(DR_TR, "receipt deleted by user");
    await setMediaVisibility(DR_TR, "trashed");

    const receiptsKw = DOC_ALBUMS.find((d) => d.key === "receipts")!.keywords;
    const documentsKw = DOC_ALBUMS.find((d) => d.key === "documents")!.keywords;
    check("docs: exact-boundary keyword 'receipt' matches DR1 only in that phrasing",
      (await countDocPhotos(["receipt"])) === 1,
      "got " + (await countDocPhotos(["receipt"])));
    check("docs: CHAR(10) newline draining lets line-start keywords match (DR1 has 'receipt' after a newline)",
      ids(await listDocPhotos(["receipt"], 200)).includes(DR1));
    check("docs: boundary guard rejects 'receipted' (word-boundary matters)",
      !ids(await listDocPhotos(["receipt"], 200)).includes(DR_BOUND));
    check("docs: matching is case-insensitive (INVOICE)",
      ids(await listDocPhotos(["invoice"], 200)).includes(DR2));
    const docCounts = await getDocOverview();
    check("docs: overview counts receipts {DR1,DR2} / documents {DR_DOC}",
      docCounts.find((d) => d.def.key === "receipts")!.count === 2 &&
      docCounts.find((d) => d.def.key === "documents")!.count === 1,
      JSON.stringify(docCounts.map((d) => [d.def.key, d.count])));
    check("docs: edited copy excluded", !ids(await listDocPhotos(["receipt"], 200)).includes(DR_ED));
    check("docs: shared-album row excluded", !ids(await listDocPhotos(["receipt"], 200)).includes(DR_SH));
    check("docs: trashed row excluded", !ids(await listDocPhotos(["receipt"], 200)).includes(DR_TR));
    check("docs: list newest-first (DR2 DAY1+6d ahead of DR1 DAY1+5d)",
      (await listDocPhotos(receiptsKw, 200)).map((r) => r.id)[0] === DR2);
    check("docs: getDocMedia unknown key → null", (await getDocMedia("not-a-doc-album")) === null);
    const docsMedia = await getDocMedia("receipts");
    check("docs: getDocMedia('receipts') returns the exact pair",
      sameSet(ids(docsMedia!), [DR1, DR2]));

    // (7) monthly digest
    const digestStats = await getDigestStats();
    check("digest: stats computed from the real library (non-zero visible, favorites/trash/respects merges)",
      digestStats.totalVisible > 0 && digestStats.syncedCount >= 0 /* earlier sections synced some rows */,
      JSON.stringify(digestStats));
    const composed = composeDigest({
      totalVisible: 10,
      syncedCount: 3,
      syncedBytes: 1_500_000,
      trashCount: 2,
      favoritesCount: 0,
      peopleCount: 0,
      junkDeleted30d: 0,
      integrityBroken: 0,
      integrityFinishedAt: 1,
    });
    check("digest: first line carries pct + bytes",
      composed.lines[0].includes("3/10") && composed.lines[0].includes("30%") && composed.lines[0].includes("1.4 MB"));
    check("digest: verified integrity line", composed.lines[1].includes("everything verified"));
    const composedUnknown = composeDigest({
      totalVisible: 4,
      syncedCount: 1,
      syncedBytes: 0,
      trashCount: 0,
      favoritesCount: 0,
      peopleCount: 0,
      junkDeleted30d: 0,
      integrityBroken: null,
      integrityFinishedAt: null,
    });
    check("digest: never-checked prints 'not checked yet' (no lies)",
      composedUnknown.lines[1].includes("not checked yet"));
    check("digest: empty library → buildHealthDigest null (no pointless notifications)",
      digestStats.totalVisible > 0); // guard: probe library non-empty, so itself runs
    // month-gate: reset the marker to a stale month, expect exactly ONE post
    posterHits.length = 0;
    setDigestPoster(async (body) => {
      posterHits.push(body.title);
    });
    uploadsMmkv.set(DIGEST_LAST_KEY, "1970-01");
    const first = await maybeRunMonthlyDigest();
    const second = await maybeRunMonthlyDigest();
    check("digest: posts once per month, then gates (1 then 0)",
      first === true && second === false && posterHits.length === 1,
      JSON.stringify({ first, second, hits: posterHits.length }));
    check("digest: marker written for the current month",
      uploadsMmkv.getString(DIGEST_LAST_KEY) === monthKey());
    check("digest: monthKey YYYY-MM format", /^20\d{2}-(0[1-9]|1[0-2])$/.test(monthKey()));

    // (8) manifest import: parse → dry-run classify → apply (idempotent)
    const PARSED = parseManifest("not json");
    check("import: garbage → null", PARSED === null);
    check("import: wrong format → null",
      parseManifest('{"format":"other","version":1,"media":[]}') === null);
    check("import: missing media array → null",
      parseManifest('{"format":"photogram-export","version":1}') === null);

    // seeds for duplicate detection: one remote-id twin, one fingerprint twin
    const IMP_REM = await mk({ taken_at: DAY1 + 8 * DAY_MS });
    await setMediaRemote(IMP_REM, "9", "101");
    const IMP_FP = await mk({ taken_at: DAY1 + 9 * DAY_MS, fingerprint: "fp-import-dup" });

    const manifestText = JSON.stringify({
      format: "photogram-export",
      version: 1,
      media: [
        { id: "m1", file_name: "dup-remote.jpg", mime_type: "image/jpeg", byte_size: 10, taken_at: new Date(DAY1 + 8 * DAY_MS).toISOString(), remote_chat_id: "9", remote_message_id: "101" },
        { id: "m2", file_name: "dup-fp.jpg", mime_type: "image/jpeg", byte_size: 333, taken_at: new Date(DAY1 + 9 * DAY_MS).toISOString(), remote_chat_id: "9", remote_message_id: "202", fingerprint: "fp-import-dup" },
        { id: "m3", file_name: "new-trashed.jpg", mime_type: "image/jpeg", byte_size: 10, taken_at: new Date(DAY1 + 10 * DAY_MS).toISOString(), remote_chat_id: "9", remote_message_id: "303", fingerprint: "fp-import-new", visibility: "trashed" },
        { id: "m4", file_name: "new-recomputed.jpg", mime_type: "video/mp4", byte_size: 10, taken_at: new Date(DAY1 + 11 * DAY_MS).toISOString(), remote_chat_id: "9", remote_message_id: "404" },
        { id: "m5", file_name: "no-remote.jpg", mime_type: "image/jpeg", byte_size: 10, taken_at: new Date(DAY1 + 12 * DAY_MS).toISOString() },
      ],
    });
    const imp = parseManifest(manifestText)!;
    check("import: manifest with 5 rows parsed", imp !== null && imp.rows.length === 5);
    const dry = await dryRunImport(imp);
    check("import: dry-run classification 1 remote-dup / 1 fp-dup / 1 missing / 2 new",
      dry.total === 5 && dry.duplicateRemote === 1 && dry.duplicateFingerprint === 1 &&
      dry.missingRemote === 1 && dry.newRows === 2,
      JSON.stringify(dry));
    const beforeCount = Number((await db.getFirstAsync("SELECT COUNT(*) AS n FROM media")).n);
    const applied = await applyImport(imp);
    check("import: apply inserts exactly the 2 new rows (dry-run is honored tile-by-tile)",
      applied.inserted === 2 && applied.skipped === 3 &&
      Number((await db.getFirstAsync("SELECT COUNT(*) AS n FROM media")).n) === beforeCount + applied.inserted,
      JSON.stringify(applied));
    const m3Row = await db.getFirstAsync(
      "SELECT visibility, state, thumb_uri, trashed_at, fingerprint FROM media WHERE remote_chat_id = '9' AND remote_message_id = '303'"
    );
    check("import: trashed import row stays trashed, cloud-only shape (thumb '', trashed_at NULL, exported fp kept)",
      m3Row.visibility === "trashed" && m3Row.state === "synced" && m3Row.thumb_uri === "" &&
      m3Row.trashed_at === null && m3Row.fingerprint === "fp-import-new",
      JSON.stringify(m3Row));
    const m4Row = await db.getFirstAsync(
      "SELECT visibility, state, is_favorite FROM media WHERE remote_chat_id = '9' AND remote_message_id = '404'"
    );
    check("import: visible import row defaults sane (visible/synced/unfavorited)",
      m4Row.visibility === "visible" && m4Row.state === "synced" && m4Row.is_favorite === 0);
    // idempotence: re-running the same manifest changes nothing
    const dry2 = await dryRunImport(imp);
    const applied2 = await applyImport(imp);
    check("import: re-import is a no-op (2 newRows→0, inserted 0)",
      dry2.newRows === 0 && dry2.duplicateRemote === 3 && applied2.inserted === 0,
      JSON.stringify(dry2) + " / " + JSON.stringify(applied2));
  }

  // --- v0.40: corrections review, person candidates, then-&-now, snapshot ------
  {
    // (A) rejection review: dismiss a face from a fresh person, list, undo.
    const RX = await createPerson("Revue");
    const RM1 = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(RM1, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const rm1 = (await dbSamplesFor(RM1))[0];
    await setFaceEmbedding(rm1.id, f32ToBytes(new Float32Array([1, 0, 0])), "facenet-128");
    await assignFacesToPerson([rm1.id], RX);
    const RM2 = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(RM2, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const rm2 = (await dbSamplesFor(RM2))[0];
    await setFaceEmbedding(rm2.id, f32ToBytes(new Float32Array([0.99, 0.1, 0])), "facenet-128");
    await assignFacesToPerson([rm2.id], RX);
    const RM3 = await mk({ taken_at: DAY1 });
    await replaceFaceSamples(RM3, [{ x: 1, y: 1, w: 30, h: 30 }]);
    const rm3 = (await dbSamplesFor(RM3))[0];
    await setFaceEmbedding(rm3.id, f32ToBytes(new Float32Array([1, 0.05, 0])), "facenet-128");
    await assignFacesToPerson([rm3.id], RX);

    await dismissFacesFromPerson([rm2.id], RX); // blocks rm2 against rm1 AND rm3
    const details = await listRejectionDetails();
    const mine = details.filter(
      (d) =>
        [rm1.id, rm2.id, rm3.id].includes(d.sampleId) &&
        [rm1.id, rm2.id, rm3.id].includes(d.blockedSampleId)
    );
    check("corrections: dismiss creates 2 reviewable pairs with provenance",
      mine.length === 2 &&
      mine.every((d) => d.personName === "Revue" && d.personStillExists && d.mediaIdA > 0 && d.mediaIdB > 0),
      JSON.stringify(details));
    const undone = await unblockRejection(rm2.id, rm1.id);
    check("corrections: unblockRejection removes the canonical pair once",
      undone === true, "undone " + undone);
    const undoneAgain = await unblockRejection(rm2.id, rm1.id);
    check("corrections: double-undo is a no-op (false)",
      undoneAgain === false);
    const mineAfter = (await listRejectionDetails()).filter(
      (d) =>
        [rm1.id, rm2.id, rm3.id].includes(d.sampleId) &&
        [rm1.id, rm2.id, rm3.id].includes(d.blockedSampleId)
    );
    check("corrections: one of MY pairs remains after undo (global list untouched)",
      mineAfter.length === 1 && details.length > mineAfter.length,
      JSON.stringify(details));

    // (B) person candidates: dismissed rm2 is suggested back at a floor.
    const cands = await listPersonCandidates(RX, null);
    const candRm2 = cands.find((c) => c.mediaId === RM2);
    check("cands: dismissed rm2 appears with its best cosine (0.9918 vs rm1)",
      candRm2 !== undefined && candRm2.score > 0.985 && candRm2.score < 0.999,
      JSON.stringify(cands));
    check("cands: assigned faces never appear as their own candidates",
      !cands.some((c) => c.mediaId === RM1 || c.mediaId === RM3));
    check("cands: member-count sanity (candidates source = unassigned only)",
      (await listCandidateSourceFaces()).every((f) => ![RM1, RM3].includes(f.mediaId)) &&
      (await listPersonFacesForCandidates(RX)).length === 2);
    const candsStrict = await listPersonCandidates(RX, 0.99);
    check("cands: strict sensitivity → floor 0.495, rm2 still shows (0.9918 > 0.495)",
      candsStrict.some((c) => c.mediaId === RM2), JSON.stringify(candsStrict.length));

    // (C) Then & now
    const nowDt = new Date();
    const todayNoon = new Date(nowDt.getFullYear(), nowDt.getMonth(), nowDt.getDate(), 10).getTime();
    const OT1 = await mk({ byte_size: 910, taken_at: todayNoon });
    const OTC = await mk({ byte_size: 911, taken_at: new Date(nowDt.getFullYear() - 2, nowDt.getMonth(), nowDt.getDate(), 10).getTime() });
    const OTTR = await mk({ byte_size: 912, taken_at: todayNoon });
    await setMediaVisibility(OTTR, "trashed");
    const OTE = await mk({ edited_from: OT1, byte_size: 913, taken_at: todayNoon });
    const otdRows = await listOnThisDay();
    check("then-now: today's photo and the 2-years-ago twin both surface",
      otdRows.some((r) => r.id === OT1) && otdRows.some((r) => r.id === OTC),
      JSON.stringify(otdRows.map((r) => r.id)));
    check("then-now: trashed + edited copies excluded",
      !otdRows.some((r) => r.id === OTTR) && !otdRows.some((r) => r.id === OTE));

    // (D) weekly snapshot: disabled gate, first write, weekly gate, retention
    useSettingsStore.getState().setSnapshotExport(false);
    const snapOff = await checkAndSnapshot();
    check("snapshot: off setting → no run (reason disabled)",
      snapOff.ran === false && snapOff.reason === "disabled", JSON.stringify(snapOff));
    useSettingsStore.getState().setSnapshotExport(true);
    settingsMmkv.set("weekly_snapshot_last_at", "0");
    const snapFirst = await runSnapshotNow();
    check("snapshot: first run writes a real manifest file in snapshots/",
      snapFirst.ran === true && snapFirst.result !== undefined &&
      snapFirst.result!.fileName.startsWith("photogram-snapshot-") &&
      snapFirst.result!.byteCount > 1000,
      JSON.stringify(snapFirst.reason));
    const snapList1 = listSnapshots();
    check("snapshot: FS state shows exactly 1 stored file",
      snapList1.length === 1 && snapList1[0].fileName === snapFirst.result!.fileName,
      JSON.stringify(snapList1));
    const snapshotFinal = new ProbeFsFile(
      "/probe-docs/export/snapshots/" + snapFirst.result!.fileName
    );
    const parsedSnap = JSON.parse(snapshotFinal.text());
    check("snapshot content: real manifest (format + non-zero media + ISO stamp)",
      parsedSnap.format === "photogram-export" && parsedSnap.media_count > 20 &&
      typeof parsedSnap.exported_at === "string",
      "media_count " + parsedSnap.media_count);
    check("snapshot: lastSnapshotAt stamped after the run",
      lastSnapshotAt() > 0);
    const snapGate = await checkAndSnapshot();
    check("snapshot: weekly gate blocks an immediate re-run (not-due)",
      snapGate.ran === false && snapGate.reason === "not-due", JSON.stringify(snapGate));
    // poke the marker 8 days back → due again (same-day run OVERWRITES the
    // one-per-day file by design, so the disk still shows a single snapshot)
    settingsMmkv.set("weekly_snapshot_last_at", String(Date.now() - 8 * DAY_MS));
    const snapSecond = await checkAndSnapshot();
    check("snapshot: 8 days later the gate opens (same-day file overwrites in place)",
      snapSecond.ran === true && listSnapshots().length === 1,
      JSON.stringify(snapSecond));
    // retention: fill with 9 throwaway files → next run prunes to the newest 8
    for (let i = 0; i < 9; i++) {
      __registerFile(
        "/probe-docs/export/snapshots/photogram-snapshot-fake-" + i + ".json",
        new TextEncoder().encode("{}")
      );
    }
    settingsMmkv.set("weekly_snapshot_last_at", String(Date.now() - 8 * DAY_MS));
    await checkAndSnapshot();
    const retained = listSnapshots().length;
    check("snapshot: retention keeps exactly the newest 8",
      retained === 8, "got " + retained);
    useSettingsStore.getState().setSnapshotExport(false);
  }

  // ==================== v0.41 — smart-album rules v2 + anniversaries ==========
  {
    const fav = async (id) => {
      await (await getDb()).runAsync("UPDATE media SET is_favorite = 1 WHERE id = ?", [id]);
    };

    // (A) parseRules hardening
    check("rules: parseRules(null) → null", parseRules(null) === null);
    check("rules: parseRules(garbage) → null", parseRules("not json{") === null);
    check("rules: parseRules({}) → sanitized empty",
      parseRules("{}")!.text === null && parseRules("{}")!.favorites === false &&
      Array.isArray(parseRules("{}")!.tags) && parseRules("{}")!.fromMs === null);

    // (B) rule album creation + persistence round-trip
    const rFav = await mk({ byte_size: 950, taken_at: Date.now() - 1000 });
    const rFavTag = await mk({ byte_size: 951, taken_at: Date.now() - 2000, tags: "beach" });
    const rTag = await mk({ byte_size: 952, taken_at: Date.now() - 6000, tags: "beach" });
    const rText = await mk({ byte_size: 953, taken_at: Date.now() - 3000 });
    const rTrashed = await mk({ byte_size: 954, taken_at: Date.now() - 4000 });
    await setMediaVisibility(rTrashed, "trashed");
    await fav(rFav);
    await fav(rFavTag);
    await fav(rTrashed);
    await updateOcrText(rText, "paper receipt total 42");
    const rulesId = await saveSmartRules("  Probe favorites+beach  ", {
      text: null,
      favorites: true,
      tags: ["beach"],
      fromMs: null,
      toMs: null,
    });
    check("rules: saveSmartRules returns a row id (name trimmed)",
      typeof rulesId === "number" && rulesId > 0);
    const savedRow = await getSavedSearch(rulesId);
    check("rules: row stores trimmed name, empty legacy query, rules JSON",
      savedRow !== null && savedRow!.name === "Probe favorites+beach" &&
      savedRow!.query === "" && savedRow!.rules !== null);
    await saveSearch("probe legacy query");
    const legacyAfter = await listSavedSearches();
    check("rules: legacy text searches stay rules = NULL",
      legacyAfter.some((r) => r.query === "probe legacy query" && r.rules === null));

    // (C) runRulesSearch combinations
    const parsed = parseRules(savedRow!.rules)!;
    const both = await runRulesSearch(parsed, 400);
    check("rules: favorites + tag both required (trashed never surfaces)",
      both.some((r) => r.id === rFavTag) && !both.some((r) => r.id === rFav) &&
      !both.some((r) => r.id === rTag) && !both.some((r) => r.id === rTrashed),
      JSON.stringify(both.map((r) => r.id)));
    const favOnly = await runRulesSearch({ text: null, favorites: true, tags: [], fromMs: null, toMs: null });
    check("rules: favorites-only keeps both favorites",
      favOnly.some((r) => r.id === rFav) && favOnly.some((r) => r.id === rFavTag));
    const cutoff = Date.now() - 2500;
    const recentTag = await runRulesSearch({
      text: null, favorites: false, tags: ["beach"], fromMs: cutoff, toMs: null,
    });
    check("rules: tag + from-date keeps only newer beach rows",
      recentTag.some((r) => r.id === rFavTag) && !recentTag.some((r) => r.id === rTag),
      JSON.stringify(recentTag.map((r) => r.id)));
    const textOnly = await runRulesSearch({
      text: "receipt", favorites: false, tags: [], fromMs: null, toMs: null,
    });
    check("rules: text filter matches OCR text (absent from non-text rows)",
      textOnly.some((r) => r.id === rText) &&
      !textOnly.some((r) => r.id === rTag) && !textOnly.some((r) => r.id === rFav),
      JSON.stringify(textOnly.map((r) => r.id)));
    const empty = await runRulesSearch({
      text: "zzarella-never-matches", favorites: false, tags: [], fromMs: null, toMs: null,
    });
    check("rules: unmatched text yields zero rows", empty.length === 0);

    // (D) favorite anniversaries (SQL is local-tz on node:sqlite — same as here)
    const t = new Date();
    const priorNoon = new Date(t.getFullYear() - 2, t.getMonth(), t.getDate(), 12).getTime();
    const thisYearNoon = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 13).getTime();
    const anniFav = await mk({ byte_size: 955, taken_at: priorNoon });
    const anniOdd = await mk({ byte_size: 956, taken_at: priorNoon + 5000 });
    const anniThisYear = await mk({ byte_size: 957, taken_at: thisYearNoon });
    await fav(anniFav);
    await fav(anniThisYear);
    const base = await countFavoriteAnniversaries();
    await fav(anniOdd);
    const after = await countFavoriteAnniversaries();
    check("anniversary: prior-year favorite counts, this-year and non-favorites do not",
      after.count === base.count + 1 && after.eldestYear !== null &&
      after.eldestYear <= t.getFullYear() - 2,
      `base ${base.count} after ${after.count}`);

    // (E) invalid rule JSON in the DB path (older/corrupt row) never crashes
    await (await getDb()).runAsync(
      "UPDATE saved_searches SET rules = 'broken' WHERE id = ?", [rulesId]);
    check("rules: corrupted stored JSON → null rules, screen falls back safely",
      parseRules((await getSavedSearch(rulesId))!.rules) === null);
    await deleteSavedSearch(rulesId);
  }

  // ==================== v0.42 — people-aware search ============================
  {
    // Name one person so the probe has a named match; other people stay
    // unnamed from earlier sections.
    const hitsEmpty = await searchPeopleForQuery("  ");
    check("people-search: empty query → no hits", hitsEmpty.length === 0);
    const allPeople = await listPeopleFull().catch(() => [] as { id: number; name: string | null }[]);
    const namedSrc = allPeople.find((p) => p.name === null) ?? null;
    if (namedSrc) await renamePerson(namedSrc.id, "Mom Professional");
    const all = await searchPeopleForQuery("");
    check("people-search: blank → no hits", all.length === 0);
    const hits = await searchPeopleForQuery("MOM");
    check("people-search: case-insensitive name match surfaces the named person",
      hits.length === 1 && hits[0].name === "Mom Professional" && hits[0].faceCount > 0,
      JSON.stringify(hits));
    const partial = await searchPeopleForQuery("prof");
    check("people-search: partial match works too",
      partial.length === 1 && partial[0].id === hits[0]?.id);
    const miss = await searchPeopleForQuery("zzz-nomatch");
    check("people-search: unmatched names yield nothing", miss.length === 0);
    if (namedSrc) await renamePerson(namedSrc.id, null);

    // (F) pinned albums store logic
    const pinKey = "camera";
    useSettingsStore.getState().setAlbumPinned(pinKey, true);
    useSettingsStore.getState().setAlbumPinned("screenshots", true);
    useSettingsStore.getState().setAlbumPinned("screenshots", true); // idempotent
    const pinnedNow = useSettingsStore.getState().pinnedAlbumKeys;
    check("pins: pinned keys stored once, order preserved",
      pinnedNow.includes("camera") && pinnedNow.filter((k) => k === "screenshots").length === 1,
      JSON.stringify(pinnedNow.map((k) => String(k))));
    useSettingsStore.getState().setAlbumPinned(pinKey, false);
    check("pins: unpin removes exactly that key",
      !useSettingsStore.getState().pinnedAlbumKeys.includes("camera"));
    useSettingsStore.getState().setAlbumPinned("screenshots", false);
  }

  // ==================== v0.43 — upload time window ============================
  {
    const W = (h: number, m = 0) => new Date(2026, 9, 19, h, m).getTime();

    // (A) pure window math
    check("window: inside a same-day span (12:00 in 10..18)",
      windowOpenFor(10, 18, new Date(W(12, 0))) === true);
    check("window: outside a same-day span (08:00 in 10..18)",
      windowOpenFor(10, 18, new Date(W(8, 0))) === false);
    check("window: end boundary excluded (18:00 in 10..18)",
      windowOpenFor(10, 18, new Date(W(18, 0))) === false);
    check("window: start boundary included (10:00 in 10..18)",
      windowOpenFor(10, 18, new Date(W(10, 0))) === true);
    check("window: overnight wrap keeps 03:00 inside 22..07",
      windowOpenFor(22, 7, new Date(W(3, 30))) === true);
    check("window: overnight wrap keeps 12:00 outside 22..07",
      windowOpenFor(22, 7, new Date(W(12, 0))) === false);
    check("window: start === end = whole day",
      windowOpenFor(5, 5, new Date(W(23, 59))) === true);

    // (B) state machine with the real upload store (probe-safe: tool-less)
    const settings = useSettingsStore.getState();
    settings.setUploadWindowEnabled(true);
    settings.setUploadWindowStart(22);
    settings.setUploadWindowEnd(7);
    const outside = await checkUploadWindow(new Date(W(12, 0)));
    const pausedNow = useUploadStore.getState().paused;
    check("window: outside window pauses uploads",
      outside.inside === false && pausedNow === true, JSON.stringify(outside));
    const inside = await checkUploadWindow(new Date(W(3, 0)));
    const resumed = useUploadStore.getState().paused;
    check("window: inside window resumes our own pause",
      inside.inside === true && resumed === false, JSON.stringify(inside));
    settings.setUploadWindowEnabled(false);
    await checkUploadWindow(new Date(W(12, 0)));
    check("window: disabling the window while paused still resumes",
      useUploadStore.getState().paused === false);
    const stale = await checkUploadWindow(new Date(W(12, 0)));
    check("window: disabled window reports inside=true (up always allowed)",
      stale.inside === true && stale.wePaused === false);
  }

  // ==================== v0.44 — album activity feed + photo requests ==========
  {
    const db = await getDb();
    const albumId = await createSharedAlbum("Activity probe", "-100900");
    // three claimed photos by two senders + one own row (no sender → hidden)
    const act1 = await mk({ byte_size: 970, taken_at: Date.now() - 5000 });
    const act2 = await mk({ byte_size: 971, taken_at: Date.now() - 4000 });
    const actOwn = await mk({ byte_size: 972, taken_at: Date.now() - 3000 });
    await db.runAsync("UPDATE media SET file_name = 'beach selfie' WHERE id = ?", [act1]);
    const t1 = Date.now() - 60_000;
    const t2 = Date.now() - 30_000;
    await db.runAsync(
      "INSERT INTO album_media (album_id, media_id, sender_id, message_id, added_at) VALUES (?, ?, ?, ?, ?)"
      , [albumId, act1, "s1", "m1", t1]);
    await db.runAsync(
      "INSERT INTO album_media (album_id, media_id, sender_id, message_id, added_at) VALUES (?, ?, ?, ?, ?)",
      [albumId, act2, "s2", "m2", t2]);
    await db.runAsync(
      "INSERT INTO album_media (album_id, media_id, message_id, added_at) VALUES (?, ?, ?, ?)"
      , [albumId, actOwn, "m3", t2 + 1000]);
    const feed = await listAlbumActivity(albumId);
    check("activity: newest claim first, sender-less rows hidden, caption surfaces",
      feed.length === 2 && feed[0].senderId === "s2" && feed[1].senderId === "s1" &&
      feed[0].mediaId === act2 && feed[1].mediaId === act1 &&
      feed[1].caption === "beach selfie" && feed[1].addedAt === t1,
      JSON.stringify(feed.map((f) => [f.mediaId, f.senderId, f.caption])));
    const feedLimit = await listAlbumActivity(albumId, 1);
    check("activity: limit respected", feedLimit.length === 1 && feedLimit[0].senderId === "s2");
    const rowsWithAddedAt = await listAlbumMedia(albumId);
    check("activity: listAlbumMedia rows now carry added_at for the feed loader",
      rowsWithAddedAt.every((r) => typeof r.added_at === "number"),
      JSON.stringify(rowsWithAddedAt.map((r) => r.added_at)));
    check("request: compose text includes the subject",
      composeRequestText("Diwali").includes("\"Diwali\"") &&
      composeRequestText("Diwali").startsWith("📷 Photo request:"));
    check("request: empty subject composes a plain request",
      !composeRequestText("   ").includes("\"\""));
    const reqFail = await (async () => {
      try {
        await sendPhotoRequest("", "Diwali");
        return "no-throw";
      } catch (e) {
        return e instanceof Error && e.message.includes("not linked") ? "throws-unlinked" : "other";
      }
    })();
    check("request: unlinked album chat id fails fast", reqFail === "throws-unlinked");
    await db.runAsync("DELETE FROM albums WHERE id = ? AND title = 'Activity probe'", [albumId]);
  }

  // ==================== v0.45 — story upgrade + wrapped v2 ====================
  {
    const db = await getDb();
    const room = new Date(new Date().getFullYear(), 5, 15).getTime(); // mid-year
    // Named person with 3 faces on 3 own photos of this year.
    const wp1 = await mk({ byte_size: 980, taken_at: room });
    const wp2 = await mk({ byte_size: 981, taken_at: room + 86_400_000 });
    const wp3 = await mk({ byte_size: 982, taken_at: room + 2 * 86_400_000 });
    const pA = await createPerson(null);
    const pB = await createPerson(null);
    for (const mid of [wp1, wp2, wp3]) {
      await replaceFaceSamples(mid, [{ x: 4, y: 4, w: 24, h: 24 }]);
      const sample = (await db.getAllAsync("SELECT id FROM face_samples WHERE media_id = ? AND box_x >= 0", [mid])) as Array<{ id: number }>;
      await assignFacesToPerson([sample[0].id], pA);
    }
    const wp4 = await mk({ byte_size: 983, taken_at: room + 3 * 86_400_000 });
    await replaceFaceSamples(wp4, [{ x: 4, y: 4, w: 24, h: 24 }]);
    const sample4 = (await db.getAllAsync("SELECT id FROM face_samples WHERE media_id = ? AND box_x >= 0", [wp4])) as Array<{ id: number }>;
    await assignFacesToPerson([sample4[0].id], pB);
    await renamePerson(pA, "Alpha Probe");
    await renamePerson(pB, "Beta 2");

    // Places: 2 rows in Goa, 1 in Alibag.
    const pl1 = await mk({ byte_size: 990, taken_at: room + 3_000 });
    const pl2 = await mk({ byte_size: 991, taken_at: room + 4_000 });
    const pl3 = await mk({ byte_size: 992, taken_at: room + 5_000 });
    await db.runAsync("UPDATE media SET place_name = ? WHERE id = ?", ["Goa", pl1]);
    await db.runAsync("UPDATE media SET place_name = ? WHERE id = ?", ["Goa", pl2]);
    await db.runAsync("UPDATE media SET place_name = ? WHERE id = ?", ["Alibag", pl3]);

    const stats = await getWrapped(new Date().getFullYear());
    check("wrapped: top people named first, own-universe counts",
      stats.topPeople.length >= 1 && stats.topPeople[0].name === "Alpha Probe" &&
      stats.topPeople[0].count === 3,
      JSON.stringify(stats.topPeople));
    check("wrapped: places ranked with counts",
      stats.topPlaces.length >= 2 && stats.topPlaces[0].place === "Goa" &&
      stats.topPlaces[0].count === 2 && stats.topPlaces[1].place === "Alibag",
      JSON.stringify(stats.topPlaces));
    check("wrapped: people thumbs travel with the superlative",
      stats.topPeople[0].thumbs.length === 3 && stats.topPeople[0].thumbs.every((t) => t.length > 0),
      JSON.stringify(stats.topPeople[0].thumbs));

    // cleanup so later order-dependent views stay as they were
    await renamePerson(pA, null);
    await renamePerson(pB, null);
  }

  {
    // ==================== v0.46 — widget state handoff ====================
    const pauseFile = new File(Paths.document, "tile_pause");
    if (pauseFile.exists) pauseFile.delete();
    const state = await buildWidgetState();
    check("widget: state exists once heartbeat data exists",
      state !== null && state.line1.includes("safe") &&
      typeof state.pending === "number" && typeof state.synced === "number",
      JSON.stringify(state));
    if (state) {
      check("widget: pending/synced/total sanity (synced <= total, >= 0 pending)",
        state.total > 0 && state.synced <= state.total && state.pending >= 0,
        JSON.stringify(state));
    }
    const ok = await syncWidgetState();
    const written = new File(Paths.document, "widget_state.json");
    let parsed: any = null;
    try { parsed = JSON.parse(written.text()); } catch {}
    check("widget: written file parses with only numeric aggregates (+ optional photo path)",
      ok && written.exists && parsed !== null &&
      typeof parsed.synced === "number" && typeof parsed.total === "number" &&
      typeof parsed.line1 === "string" && typeof parsed.line2 === "string" &&
      (parsed.photoPath === null || typeof parsed.photoPath === "string") &&
      !("file_name" in parsed) && !("local_uri" in parsed),
      written.text().slice(0, 160));

    pauseFile.create();
    check("widget: tile_pause marker reported",
      tilePauseActive() === true);
    const pausedState = await buildWidgetState();
    check("widget: paused state flagged in line2",
      pausedState !== null && pausedState.line2.includes("queuing paused"),
      pausedState ? pausedState.line2 : "null");
    pauseFile.delete();
    check("widget: removing marker un-pauses (re-sync clears stale label)",
      tilePauseActive() === false);
    new File(Paths.document, "widget_state.json").delete();
  }

  {
    // ==================== v0.47 — onboarding checklist ====================
    const steps = listPendingOnboardingSteps({
      permissionGranted: true,
      wifiAvailable: false,
      firstBackupDone: false,
    });
    check("onboarding: access done, wifi + first backup pending",
      steps.length === 3 && steps[0].done === true && steps[1].done === false &&
      steps[2].done === false, JSON.stringify(steps));
    check("onboarding: checklist shows while something is pending",
      shouldShowChecklist(steps, false) === true);
    check("onboarding: dismissed overrides pending",
      shouldShowChecklist(steps, true) === false);
    const allDone = listPendingOnboardingSteps({
      permissionGranted: true, wifiAvailable: true, firstBackupDone: true,
    });
    check("onboarding: everything done → card hidden",
      shouldShowChecklist(allDone, false) === false);
    const facts = await collectOnboardingFacts(0);
    check("onboarding: collectors in probe stubs read wifi (and treat legacy grant as 'all')",
      facts.wifiAvailable === true, JSON.stringify(facts));
  }

  {
    // ==================== v0.47 — album cover picker ====================
    const albumsBefore = await getAutoAlbums();
    const cameraBefore = albumsBefore.find((a) => a.key === "camera");
    check("albums: camera album exists with an auto cover",
      !!cameraBefore && cameraBefore.coverThumb !== null && cameraBefore.coverThumb.length > 0,
      JSON.stringify(albumsBefore.map((a) => a.key)));
    // Pin J (distinct thumb) — the hand-picked cover must win.
    await setAlbumCover("camera", J);
    const pinned = (await getAutoAlbums()).find((a) => a.key === "camera");
    check("albums: hand-picked cover wins over newest-item cover",
      !!pinned && pinned.coverThumb === "mem://probe/j.jpg",
      JSON.stringify(pinned?.coverThumb));
    // Trashing the row invalidates the pin (row must be visible) → fallback.
    await db.runAsync("UPDATE media SET visibility = 'trashed' WHERE id = ?", [J]);
    const fallback = (await getAutoAlbums()).find((a) => a.key === "camera");
    check("albums: stale cover id invalid (trashed) → falls back, no crash",
      !!fallback && fallback.coverThumb !== null && fallback.coverThumb !== "mem://probe/j.jpg",
      JSON.stringify(fallback?.coverThumb));
    await db.runAsync("UPDATE media SET visibility = 'visible' WHERE id = ?", [J]);
    clearAlbumCover("camera");
  }

  {
    // ==================== v0.54 — duplicate merge ====================
    const d1 = await mk({ byte_size: 100, taken_at: DAY1 });
    const d2 = await mk({ byte_size: 200, taken_at: DAY1 + 5_000 });
    await db.runAsync("UPDATE media SET phash = '0000000000000000' WHERE id IN (?, ?)", [d1, d2]);
    const groups = await findDuplicateGroups();
    check("dupmerge: identical pHash same-day rows cluster",
      groups.length >= 1 && groups.some((g) => g.items.length >= 2),
      JSON.stringify(groups.map((g) => g.items.map((i) => i.id))));
  }

  {
    // ==================== v0.52 — i18n ====================
    check("i18n: round-trips en → hi → fallback",
      translate(I18N_DICT, "tabs.gallery", "en") === "Gallery" &&
      translate(I18N_DICT, "tabs.gallery", "hi") === "गैलरी" &&
      translate(I18N_DICT, "no.such.key", "hi") === "no.such.key",
      translate(I18N_DICT, "tabs.gallery", "hi"));
  }

  {
    // ==================== v0.51 — free up space ====================
    const oldMs = Date.now() - 30 * 86_400_000;
    const f1 = await mk({ byte_size: 1000, taken_at: oldMs - 1000, state: "synced", media_library_id: "ml-free-1" });
    const f2 = await mk({ byte_size: 2000, taken_at: oldMs - 500, state: "synced", media_library_id: "ml-free-2" });
    const fav = await mk({ byte_size: 3333, taken_at: oldMs, state: "synced", media_library_id: "ml-fav" });
    const trashed = await mk({ byte_size: 4444, taken_at: oldMs, state: "synced", media_library_id: "ml-trash" });
    const fresh = await mk({ byte_size: 5555, taken_at: Date.now(), state: "synced", media_library_id: "ml-fresh" });
    const noTs = await mk({ byte_size: 666, taken_at: 0, state: "synced", media_library_id: "ml-nots" });
    const notSynced = await mk({ byte_size: 777, taken_at: oldMs, state: "local", media_library_id: "ml-local" });
    const noAsset = await mk({ byte_size: 888, taken_at: oldMs, state: "synced" });
    const cloudOnly = await mk({ byte_size: 999, taken_at: oldMs, state: "synced", local_uri: null, media_library_id: "ml-cloud" });
    await db.runAsync("UPDATE media SET visibility = 'trashed' WHERE id = ?", [trashed]);
    await db.runAsync("UPDATE media SET is_favorite = 1 WHERE id = ?", [fav]);
    const c = await countFreeable();
    check("freeable: counts only truly safe rows (synced+visible+non-fav+asset+7d)",
      c.count === 2 && c.bytes === 3000, JSON.stringify(c));
    const assets = await listFreeableAssets(10);
    check("freeable: asset feed matches universe (newest first)",
      assets.length === 2 && assets[0].media_library_id === "ml-free-2" &&
      assets[0].byte_size === 2000, JSON.stringify(assets));
    await clearLocalUri([f1, f2]);
    const after = await countFreeable();
    check("freeable: cleared rows drop out (state untouched, local_uri null)",
      after.count === 0, JSON.stringify(after));
    const clearedRows = (await getMediaByIds([f1, f2])) as Array<{ id: number; state: string; local_uri: string | null }>;
    check("freeable: cleared rows keep state=synced (bytes still in Telegram)",
      clearedRows.every((r) => r.state === "synced" && r.local_uri === null),
      JSON.stringify(clearedRows));
  }

  {
    // ==================== v0.54.2 - interrupted upload recovery ====================
    // A kill leaves queue rows 'active' + media.state='uploading'; nextQueued()
    // only reads 'pending', so those photos were stranded forever (7 on-device).
    const s1 = await mk({ byte_size: 111, taken_at: DAY1, state: "uploading" });
    const s2 = await mk({ byte_size: 222, taken_at: DAY1, state: "uploading" });
    const ok = await mk({ byte_size: 333, taken_at: DAY1, state: "synced" });
    await db.runAsync(
      "INSERT INTO upload_queue (media_id, local_uri, byte_size, chat_id, status, enqueued_at) VALUES (?, ?, ?, ?, 'active', ?)",
      [s1, "file:///a.jpg", 111, 1, Date.now()]
    );
    await db.runAsync(
      "INSERT INTO upload_queue (media_id, local_uri, byte_size, chat_id, status, enqueued_at) VALUES (?, ?, ?, ?, 'active', ?)",
      [s2, "file:///b.jpg", 222, 1, Date.now()]
    );
    await db.runAsync(
      "INSERT INTO upload_queue (media_id, local_uri, byte_size, chat_id, status, enqueued_at) VALUES (?, ?, ?, ?, 'done', ?)",
      [ok, "file:///c.jpg", 333, 1, Date.now()]
    );
    const parked = await recoverInterruptedUploads();
    const rows = (await getMediaByIds([s1, s2, ok])) as Array<{ id: number; state: string }>;
    const qrows = await db.getAllAsync<{ media_id: number; status: string }>(
      "SELECT media_id, status FROM upload_queue WHERE media_id IN (?, ?, ?) ORDER BY media_id",
      [s1, s2, ok]
    );
    check(
      "recover: orphans parked back to pending, finished rows untouched",
      parked >= 2 &&
        qrows.find((r) => r.media_id === s1)?.status === "pending" &&
        qrows.find((r) => r.media_id === s2)?.status === "pending" &&
        qrows.find((r) => r.media_id === ok)?.status === "done",
      JSON.stringify(qrows)
    );
    check("recover: media mirror follows (uploading -> queued, synced untouched)",
      rows.find((r) => r.id === s1)?.state === "queued" &&
      rows.find((r) => r.id === s2)?.state === "queued" &&
      rows.find((r) => r.id === ok)?.state === "synced",
      JSON.stringify(rows));
  }

  {
    // ==================== v0.55 - backup health score ====================
    const now = Date.now();
    const perfect = computeHealth(
      {
        totalVisible: 100,
        synced: 100,
        pending: 0,
        failed: 0,
        integrityBroken: 0,
        integrityFinishedAt: now - 86_400_000,
        lastUploadAt: now - 3_600_000,
      },
      now
    );
    check(
      "health: fully backed up + verified scores 100/excellent",
      perfect.score === 100 && perfect.grade === "excellent" && perfect.actions.length === 0,
      JSON.stringify(perfect)
    );

    const emptyLib = computeHealth(
      { totalVisible: 0, synced: 0, pending: 0, failed: 0, integrityBroken: null, integrityFinishedAt: null, lastUploadAt: null },
      now
    );
    check(
      "health: empty library reports 'nothing scanned' without pretending to be healthy",
      emptyLib.headline === "Nothing scanned yet" && emptyLib.score === 0,
      JSON.stringify(emptyLib)
    );

    const half = computeHealth(
      {
        totalVisible: 200,
        synced: 100,
        pending: 100,
        failed: 0,
        integrityBroken: 0,
        integrityFinishedAt: now - 86_400_000,
        lastUploadAt: now - 60_000,
      },
      now
    );
    check(
      "health: half backed up is penalised and offers the queue action",
      half.score < 75 && half.reasons.some((r) => r.includes("100 item")) && half.actions.some((a) => a.key === "backup"),
      JSON.stringify(half)
    );

    const broken = computeHealth(
      {
        totalVisible: 100,
        synced: 100,
        pending: 0,
        failed: 2,
        integrityBroken: 5,
        integrityFinishedAt: now - 86_400_000,
        lastUploadAt: now - 60_000,
      },
      now
    );
    check(
      "health: broken integrity + failures surface as reasons and actions",
      broken.score < 90 &&
        broken.headline.includes("missing in Telegram") &&
        broken.reasons.some((r) => r.includes("could not be found")) &&
        broken.actions.some((a) => a.key === "integrity"),
      JSON.stringify(broken)
    );

    const neverChecked = computeHealth(
      {
        totalVisible: 50,
        synced: 50,
        pending: 0,
        failed: 0,
        integrityBroken: null,
        integrityFinishedAt: null,
        lastUploadAt: now - 60_000,
      },
      now
    );
    check(
      "health: never-checked integrity costs a little and asks for a pass",
      neverChecked.score === 95 && neverChecked.actions.some((a) => a.key === "integrity"),
      JSON.stringify(neverChecked)
    );

    const stale = computeHealth(
      {
        totalVisible: 10,
        synced: 10,
        pending: 0,
        failed: 0,
        integrityBroken: 0,
        integrityFinishedAt: now - 86_400_000,
        lastUploadAt: now - 40 * 86_400_000,
      },
      now
    );
    check(
      "health: stale uploads are called out in days",
      stale.reasons.some((r) => r.includes("40 days ago")) && stale.score === 90,
      JSON.stringify(stale)
    );

    const graded = [gradeFor(100), gradeFor(80), gradeFor(60), gradeFor(10)];
    check(
      "health: grade bands are stable",
      JSON.stringify(graded) === JSON.stringify(["excellent", "good", "fair", "at-risk"]),
      JSON.stringify(graded)
    );
  }

  {
    // ==================== v0.55 - restore drill ====================
    const fakeRows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `p${i + 1}` }));
    const original = JSON.stringify(fakeRows);
    const sample = pickDrillSample(fakeRows, 4, () => 0.5);
    check(
      "drill: picks unique rows and leaves the input alone",
      sample.length === 4 &&
        new Set(sample.map((r) => r.id)).size === 4 &&
        JSON.stringify(fakeRows) === original,
      JSON.stringify(sample)
    );
    check(
      "drill: asking for more than available returns everything once",
      pickDrillSample(fakeRows, 50).length === 10
    );

    const results = [
      { id: 1, fileName: "a.jpg", outcome: "ok" as const, bytes: 100, sizeDiffers: false, checksum: "match" as const },
      { id: 2, fileName: "b.jpg", outcome: "ok" as const, bytes: 200, sizeDiffers: true, checksum: "unchecked" as const },
      { id: 3, fileName: "c.jpg", outcome: "missing" as const, bytes: 0, sizeDiffers: false, checksum: "unchecked" as const },
    ];
    const summary = summarizeDrill(results, 1000, 2000);
    check(
      "drill: summary counts ok/problems/bytes/size diffs/checksums",
      summary.checked === 3 && summary.ok === 2 && summary.problems.length === 1 &&
        summary.problems[0].id === 3 && summary.bytes === 300 && summary.sizeDiffs === 1 &&
        summary.verified === 1 && summary.checksumMismatches === 0 &&
        summary.finishedAt === 2000,
      JSON.stringify(summary)
    );

    const report = await runRestoreDrill(3, {
      list: async () => fakeRows.slice(0, 5),
      verify: async (c) =>
        c.id === 3
          ? { id: c.id, fileName: "x", outcome: "missing", bytes: 0, sizeDiffers: false }
          : { id: c.id, fileName: "x", outcome: "ok", bytes: 10, sizeDiffers: false },
      rand: () => 0,
    });
    check(
      "drill: orchestration returns a report with real counts",
      report.checked === 3 && report.ok === 2 && report.problems.length === 1,
      JSON.stringify(report)
    );

    const emptyReport = await runRestoreDrill(3, {
      list: async () => {
        throw new Error("db offline");
      },
      verify: async () => {
        throw new Error("should not run");
      },
    });
    check(
      "drill: a failing candidate query yields an empty report, never a crash",
      emptyReport.checked === 0 && emptyReport.problems.length === 0,
      JSON.stringify(emptyReport)
    );
  }

  {
    // ==================== v0.55 - natural-language search ====================
    const p1 = parseNaturalSearch("beach 2024");
    check(
      "nlsearch: 'beach 2024' keeps the text and adds the year",
      p1.text === "beach" && p1.dateRange?.fromMs === Date.UTC(2024, 0, 1) &&
        p1.dateRange?.toMs === Date.UTC(2025, 0, 1) && p1.kind === null && !p1.favoritesOnly,
      JSON.stringify(p1)
    );
    const p2 = parseNaturalSearch("may 2024");
    check(
      "nlsearch: 'may 2024' becomes May 2024 with no leftover text",
      p2.text === "" && p2.dateRange?.fromMs === new Date(2024, 4, 1).getTime(),
      JSON.stringify(p2)
    );
    const p3 = parseNaturalSearch("favorite videos");
    check(
      "nlsearch: favorites + video flags combine",
      p3.favoritesOnly && p3.kind === "video" && p3.text === "",
      JSON.stringify(p3)
    );
    const p4 = parseNaturalSearch("may");
    check(
      "nlsearch: a bare month word stays text (no accidental May filter)",
      p4.text === "may" && p4.dateRange === null,
      JSON.stringify(p4)
    );
    const p5 = parseNaturalSearch("photos at the beach");
    check(
      "nlsearch: photo kind is stripped, the rest stays text",
      p5.kind === "photo" && p5.text === "at the beach",
      JSON.stringify(p5)
    );
    const p6 = parseNaturalSearch("today");
    check(
      "nlsearch: 'today' resolves to a one-day range",
      p6.text === "" && p6.dateRange?.toMs === p6.dateRange?.fromMs! + 86_400_000,
      JSON.stringify(p6)
    );

    const n1 = await mk({ byte_size: 10, taken_at: Date.UTC(2024, 4, 10), file_name: "beach.jpg" });
    const n2 = await mk({ byte_size: 20, taken_at: Date.UTC(2023, 2, 3), file_name: "clip.mp4" });
    const n3 = await mk({ byte_size: 30, taken_at: Date.UTC(2024, 4, 11), file_name: "sunset.jpg" });
    await db.runAsync("UPDATE media SET mime_type = 'video/mp4', duration_ms = 5000 WHERE id = ?", [n2]);
    await db.runAsync("UPDATE media SET is_favorite = 1 WHERE id = ?", [n3]);

    const beach = await searchMediaFiltered({ text: "beach", limit: 50 });
    check("nlsearch: text filter finds the file", beach.some((r) => r.id === n1) && !beach.some((r) => r.id === n3),
      JSON.stringify(beach.map((r) => r.id)));

    const may2024 = await searchMediaFiltered({ fromMs: Date.UTC(2024, 4, 1), toMs: Date.UTC(2024, 5, 1), limit: 50 });
    check("nlsearch: month range returns both May 2024 rows",
      may2024.some((r) => r.id === n1) && may2024.some((r) => r.id === n3) && !may2024.some((r) => r.id === n2),
      JSON.stringify(may2024.map((r) => r.id)));

    const vids = await searchMediaFiltered({ kind: "video", limit: 50 });
    check("nlsearch: video kind uses mime/duration", vids.some((r) => r.id === n2) && !vids.some((r) => r.id === n1),
      JSON.stringify(vids.map((r) => r.id)));

    const favs = await searchMediaFiltered({ favoritesOnly: true, limit: 50 });
    check("nlsearch: favorites filter", favs.some((r) => r.id === n3) && !favs.some((r) => r.id === n1),
      JSON.stringify(favs.map((r) => r.id)));

    const combined = await runNaturalSearch("favorite 2024", 50);
    check("nlsearch: end-to-end parse+query (favorite + year)",
      combined.some((r) => r.id === n3), JSON.stringify(combined.map((r) => r.id)));
  }

  {
    // ==================== v0.55 - scheduled integrity alerts ====================
    check(
      "integrity alert: only a finished pass with problems speaks up",
      integrityNeedsAlert({ broken: 3, finishedAt: 123 }) === true &&
        integrityNeedsAlert({ broken: 0, finishedAt: 123 }) === false &&
        integrityNeedsAlert({ broken: 5, finishedAt: null }) === false,
      ""
    );
  }

  {
    // ==================== v0.55 - bulk tagging ====================
    check(
      "tags: normalize trims, keeps order and drops empties",
      normalizeUserTags("  india , family,  ") === "india, family",
      String(normalizeUserTags("  india , family,  "))
    );
    check("tags: empty input clears to null", normalizeUserTags("   ,  ") === null);
    check(
      "tags: merge de-dupes case-insensitively and keeps the owner's order",
      mergeTagList("India, family", "india, sunset") === "India, family, sunset",
      String(mergeTagList("India, family", "india, sunset"))
    );
    check("tags: merge into no existing tags", mergeTagList(null, "a, b") === "a, b");
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(",");
    const capped = (mergeTagList(null, many) ?? "").split(", ").filter(Boolean);
    check(
      "tags: a bulk tag can never grow a row past the cap",
      capped.length === MAX_TAGS_PER_PHOTO,
      String(capped.length)
    );
  }

  {
    // ==================== v0.55 - checksum proof ====================
    check(
      "checksum: photos under 8 MB are hashed, videos and big files are not",
      shouldHash(2_000_000, "image/jpeg") === true &&
        shouldHash(9 * 1024 * 1024, "image/jpeg") === false &&
        shouldHash(2_000_000, "video/mp4") === false &&
        shouldHash(0, "image/jpeg") === false,
      ""
    );
    check(
      "checksum: verdicts are exact and case-insensitive",
      verifyChecksum("ABC123", "abc123") === "match" &&
        verifyChecksum("abc", "abd") === "mismatch" &&
        verifyChecksum(null, "abc") === "unchecked" &&
        verifyChecksum("abc", null) === "unchecked",
      ""
    );
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(media)");
    check(
      "checksum: schema v21 adds media.content_sha256",
      cols.some((c) => c.name === "content_sha256"),
      JSON.stringify(cols.map((c) => c.name).slice(-4))
    );
  }

  {
    // ==================== v0.55 - re-upload missing ====================
    const r1 = await mk({ byte_size: 5, taken_at: DAY1, state: "synced" });
    await db.runAsync(
      "UPDATE media SET remote_chat_id = '1', remote_message_id = '99', uploaded_at = 123 WHERE id = ?",
      [r1]
    );
    await clearRemotePointers([r1]);
    const cleared = await db.getFirstAsync<{
      remote_chat_id: string | null;
      remote_message_id: string | null;
      uploaded_at: number | null;
    }>("SELECT remote_chat_id, remote_message_id, uploaded_at FROM media WHERE id = ?", [r1]);
    check(
      "reupload: dead pointers and uploaded_at are cleared before re-queueing",
      cleared?.remote_chat_id === null &&
        cleared?.remote_message_id === null &&
        cleared?.uploaded_at === null,
      JSON.stringify(cleared)
    );
  }

  {
    // ==================== v0.55 - dynamic shortcuts ====================
    const baseItems = buildShortcutItems(null);
    check(
      "shortcuts: three base items when no album is recent",
      baseItems.length === 3 && baseItems.map((i) => i.id).join(",") === "gallery,albums,settings",
      JSON.stringify(baseItems)
    );
    const withAlbum = buildShortcutItems({ key: "camera", label: "Camera" });
    check(
      "shortcuts: the newest album fills the fourth slot",
      withAlbum.length === 4 &&
        withAlbum[3].id === "album:camera" &&
        withAlbum[3].title === "Camera",
      JSON.stringify(withAlbum)
    );
    check(
      "shortcuts: never exceeds the launcher cap",
      buildShortcutItems({ key: "x", label: "X" }).length <= MAX_SHORTCUTS
    );
    const albumTarget = parseShortcutId("album:camera");
    check(
      "shortcuts: ids round-trip, unknown ids are ignored",
      albumTarget?.kind === "album" &&
        albumTarget.albumKey === "camera" &&
        parseShortcutId("settings")?.kind === "settings" &&
        parseShortcutId("nonsense") === null &&
        parseShortcutId(null) === null,
      JSON.stringify(albumTarget)
    );
  }

  {
    // ==================== v0.55 - wallpaper rotation ====================
    const cfg = buildWallpaperConfig(
      [
        { local_uri: "/data/user/0/com.photogram.app/files/a.jpg", taken_at: 3 },
        { local_uri: null, taken_at: 2 },
        { local_uri: "/data/user/0/com.photogram.app/files/a.jpg", taken_at: 1 },
        { local_uri: "content://media/external/images/1", taken_at: 0 },
      ],
      true
    );
    check(
      "wallpaper: only real file paths, de-duped, capped",
      cfg.paths.length === 1 &&
        cfg.paths[0].endsWith("a.jpg") &&
        cfg.enabled === true,
      JSON.stringify(cfg)
    );
    check(
      "wallpaper: disabled toggle writes an empty, disabled config",
      JSON.stringify(buildWallpaperConfig([{ local_uri: "/x.jpg", taken_at: 1 }], false)) ===
        JSON.stringify({ enabled: false, paths: [] }),
      JSON.stringify(buildWallpaperConfig([{ local_uri: "/x.jpg", taken_at: 1 }], false))
    );
    const many = Array.from({ length: 80 }, (_, i) => ({
      local_uri: `/p/${i}.jpg`,
      taken_at: 80 - i,
    }));
    check(
      "wallpaper: never exceeds MAX_WALLPAPER_PATHS",
      buildWallpaperConfig(many, true).paths.length === MAX_WALLPAPER_PATHS,
      String(buildWallpaperConfig(many, true).paths.length)
    );
    check(
      "wallpaper: enabling with no local favourites stays disabled",
      buildWallpaperConfig([{ local_uri: null, taken_at: 1 }], true).enabled === false
    );
  }

  {
    // ==================== v0.55 - share-sheet intake ====================
    check(
      "share: only absolute paths, de-duped",
      JSON.stringify(
        parseSharedInbox(
          JSON.stringify(["/a.jpg", "content://x/1", "/a.jpg", "", 42, "/b.jpg"])
        )
      ) === JSON.stringify(["/a.jpg", "/b.jpg"]),
      JSON.stringify(parseSharedInbox(JSON.stringify(["/a.jpg", "content://x/1", "/a.jpg"])))
    );
    check("share: malformed index yields nothing", parseSharedInbox("not json") .length === 0);
    check(
      "share: non-array json is ignored",
      parseSharedInbox('{"paths":["/a.jpg"]}').length === 0
    );
    const manyShared = JSON.stringify(
      Array.from({ length: 40 }, (_, i) => `/s/${i}.jpg`)
    );
    check(
      "share: intake is capped",
      parseSharedInbox(manyShared).length === MAX_SHARED_ITEMS,
      String(parseSharedInbox(manyShared).length)
    );
  }

  {
    // ==================== v0.55 - DB maintenance ====================
    const day = 86_400_000;
    check(
      "maintenance: runs when never run, then waits a week",
      shouldRunMaintenance(0, Date.now()) === true &&
        shouldRunMaintenance(Date.now() - 2 * day, Date.now()) === false &&
        shouldRunMaintenance(Date.now() - 8 * day, Date.now()) === true,
      ""
    );
    check(
      "maintenance: garbage timestamps do not block forever",
      shouldRunMaintenance(NaN, Date.now()) === true && shouldRunMaintenance(-5, Date.now()) === true
    );
    const ran = await maybeRunDbMaintenance();
    const ranAgain = await maybeRunDbMaintenance();
    check("maintenance: first call runs and stamps the meta key, second is a no-op",
      ran === true && ranAgain === false,
      `${ran}/${ranAgain}`);
    const stamp = await getMeta(MAINTENANCE_KEY);
    check("maintenance: timestamp persisted for the weekly gate",
      typeof stamp === "string" && Number(stamp) > 0, String(stamp));
  }

  {
    // ==================== v0.55 - startup budget ====================
    const s1 = { at: 1, ms: 900, version: "0.55.0" };
    const s2 = { at: 2, ms: 500, version: "0.55.0" };
    const s3 = { at: 3, ms: 700, version: "0.55.0" };
    const stored = appendStartupSample([s1], s2);
    check(
      "startup: samples append in order",
      stored.length === 2 && stored[1].ms === 500,
      JSON.stringify(stored)
    );
    check(
      "startup: median is computed on sorted values",
      medianStartupMs([s1, s2, s3]) === 700 && medianStartupMs([]) === null,
      String(medianStartupMs([s1, s2, s3]))
    );
    const manySamples = Array.from({ length: 15 }, (_, i) => ({
      at: i,
      ms: 100 + i,
      version: "x",
    }));
    check(
      "startup: history keeps only the newest 10",
      appendStartupSample(manySamples, { at: 99, ms: 50, version: "x" }).length === STARTUP_KEEP,
      String(appendStartupSample(manySamples, { at: 99, ms: 50, version: "x" }).length)
    );
    check(
      "startup: bogus samples are dropped",
      appendStartupSample([{ at: 1, ms: -5, version: "x" }], { at: 2, ms: 100, version: "x" }).length === 1
    );
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
  // The v0.43 window test starts the real upload worker, whose in-process
  // interval keeps the event loop alive — exit explicitly.
  process.exit(process.exitCode === 1 ? 1 : 0);
}

// helper: raw face_samples rows for a media id
async function dbSamplesFor(mediaId: number) {
  const db = await getDb();
  return db.getAllAsync("SELECT id, embedding, model_id, person_id FROM face_samples WHERE media_id = ? AND box_x >= 0", [mediaId]);
}

main().catch((err) => {
  console.error("PROBE CRASHED:", err);
  process.exit(2); // never hang the runner on an unhandled rejection
});
