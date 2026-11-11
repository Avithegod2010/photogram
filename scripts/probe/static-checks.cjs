// @ts-nocheck
// tsc-invisible checks: icon names, native module APIs, theme tokens, and the
// shipped normalizeUserTags source (extracted verbatim from ViewerScreen.tsx).
const fs = require("fs");
let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS  " + name); }
  else { failed++; console.log("FAIL  " + name + (extra ? "  —  " + extra : "")); }
}

// 1) Ionicons names actually exist in the bundled glyphmap
{
  const map = JSON.parse(
    fs.readFileSync("node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json", "utf8")
  );
  const used = [
    "copy-outline", "play-outline", "close", "play-back", "play-forward", "pause", "play",
    "share-social-outline", "heart-outline", "pencil-outline", "paper-plane-outline",
    "cloud-upload-outline", "color-wand-outline", "archive-outline", "eye-off-outline", "trash-outline",
    "lock-closed", "lock-open-outline",
  ];
  for (const n of used) check("Ionicons glyph exists: " + n, typeof map[n] === "number");
}

// 2) expo-video exposes the playToEnd event (used by SlideshowScreen)
{
  const dir = "node_modules/expo-video/build";
  const hit = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".d.ts"))
    .map((f) => [f, fs.readFileSync(dir + "/" + f, "utf8")])
    .filter(([, s]) => s.includes("playToEnd"))
    .map(([f]) => f);
  check("expo-video types include playToEnd", hit.length > 0, hit.join(",") || "none");
  const events = fs.readFileSync(dir + "/VideoPlayerEvents.types.d.ts", "utf8");
  check("VideoPlayerEvents map declares playToEnd(): void", /playToEnd\(\):\s*void/.test(events));
}

// 3) expo-status-bar supports the hidden prop (SlideshowScreen)
{
  const sb = fs.readFileSync("node_modules/expo-status-bar/build/types.d.ts", "utf8");
  check("expo-status-bar supports hidden", /hidden\??:\s*boolean/.test(sb));
}

// 4) theme tokens referenced by the new screens exist in src/theme.ts
{
  const theme = fs.readFileSync("src/theme.ts", "utf8");
  for (const tok of ["surfaceHighest", "surfaceContainer", "outlineVariant", "onSurfaceVariant", "onSurface", "primary", "error", "background", "onPrimary"]) {
    check("theme.colors." + tok + " exists", theme.includes(tok + ":"));
  }
  for (const tok of ["xs", "sm", "md", "lg", "xl"]) {
    check("theme.spacing." + tok + " exists", new RegExp(tok + ":").test(theme));
  }
  for (const tok of ["md", "lg", "xl", "full"]) {
    check("theme.radius." + tok + " exists", new RegExp(tok + ":").test(theme));
  }
}

// 5) normalizeUserTags — extracted VERBATIM from the shipped src/lib/tags.ts
{
  const src = fs.readFileSync("src/lib/tags.ts", "utf8");
  const start = src.indexOf("function normalizeUserTags");
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const fnSrc = src.slice(start, end + 1)
    .replace("(raw: string)", "(raw)")
    .replace("): string | null {", ") {");
  const normalizeUserTags = new Function(fnSrc + "\nreturn normalizeUserTags;")();
  check("normalizeUserTags extracted from shipped source", typeof normalizeUserTags === "function");

  const cases = [
    ["mom, Kashmir trip 2024 , ,best food", "mom, Kashmir trip 2024, best food", "trims + drops empties"],
    ["single", "single", "single tag"],
    ["   ", null, "whitespace only → null"],
    ["", null, "empty → null"],
    [",,,", null, "commas only → null"],
    ["a".repeat(60), "a".repeat(50), "long tag capped at 50"],
    ["孟買 🇮🇳 trip, x", "孟買 🇮🇳 trip, x", "unicode preserved"],
    ["UPPER Case", "UPPER Case", "case preserved (LIKE is case-insensitive anyway)"],
  ];
  for (const [input, expected, label] of cases) {
    const got = normalizeUserTags(input);
    check("normalizeUserTags " + label, JSON.stringify(got) === JSON.stringify(expected), "got " + JSON.stringify(got));
  }
}

// N) expo-media-library: the bare "expo-media-library" entry is the class-based
// "next" API; its legacy function names exist only as typed shims that THROW at
// runtime. Every source file must import "expo-media-library/legacy" (tsc cannot
// see this — the shim types look correct).
{
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = dir + "/" + e.name;
      return e.isDirectory() ? walk(p) : [p];
    });
  const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
  const bad = files.filter((f) =>
    /(from\s+|import\s*\(\s*|require\s*\(\s*)["']expo-media-library["']/.test(
      fs.readFileSync(f, "utf8")
    )
  );
  check(
    "no source imports the expo-media-library 'next' entry (legacy shims throw)",
    bad.length === 0,
    bad.join(", ") || "none"
  );
}

// O) EAS/CNG: the widget + tile only exist because the config plugin writes them.
// If the plugin is dropped from app.config (or a template loses a class), a clean
// prebuild — including every cloud build — silently ships without both surfaces.
{
  const cfg = fs.readFileSync("app.config.ts", "utf8");
  const pluginPath = "plugins/withPhotogramWidget.js";
  check("app.config registers the widget/tile config plugin", cfg.includes("plugins/withPhotogramWidget"));
  const src = fs.existsSync(pluginPath) ? fs.readFileSync(pluginPath, "utf8") : "";
  for (const needed of [
    "PhotogramStatusWidget",
    "PhotogramTileService",
    "backup_widget_info",
    "widget_status",
    "widget_photo",
    "BitmapFactory",
    "photoPath",
    "WallpaperRotation",
    "SharedMediaIntake",
    "SEND_MULTIPLE",
    "SET_WALLPAPER",
    "BOOT_COMPLETED",
    "wallpaper_config.json",
    "QS_TILE",
    "APPWIDGET_UPDATE",
    "tile_label",
    "widget_state.json",
  ]) {
    check("widget plugin emits " + needed, src.includes(needed));
  }
}

// P) UI guard: no raw hex colours and no one-off font sizes in screen/component
// code. Colour is a token (src/theme.ts); text is an AppText variant.
// Allowlist: none — QR white/black already use theme.colors.white/black.
{
  const walk = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const p = dir + "/" + e.name;
          return e.isDirectory() ? walk(p) : [p];
        })
      : [];
  const uiFiles = [
    ...walk("src/screens"),
    ...walk("src/components"),
    ...walk("src/ui"),
  ].filter((f) => /\.(ts|tsx)$/.test(f));

  const hexHits = [];
  const fontHits = [];
  for (const file of uiFiles) {
    const src = fs.readFileSync(file, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const hex = line.match(/["'`]#[0-9a-fA-F]{3,8}["'`]/g);
      if (hex) hexHits.push(`${file}:${i + 1} ${hex.join(" ")}`);
      if (/fontSize\s*:\s*[0-9]/.test(line)) fontHits.push(`${file}:${i + 1}`);
    });
  }
  check(
    "no raw hex colours under src/screens, src/components, src/ui",
    hexHits.length === 0,
    hexHits.slice(0, 12).join(" | ") || "none"
  );
  check(
    "no one-off fontSize under src/screens, src/components, src/ui (use AppText variants)",
    fontHits.length === 0,
    fontHits.slice(0, 12).join(" | ") || "none"
  );
}

// Q) Alert.alert is reserved for OS-level confirmations. Report remaining
// in-app usages as a warning (not a hard failure) so they can be migrated
// without blocking a build.
{
  const walk = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const p = dir + "/" + e.name;
          return e.isDirectory() ? walk(p) : [p];
        })
      : [];
  const files = walk("src/screens").filter((f) => /\.tsx$/.test(f));
  const hits = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const count = (src.match(/Alert\.alert/g) || []).length;
    if (count > 0) hits.push(`${file.replace("src/screens/", "")}(${count})`);
  }
  if (hits.length > 0) {
    console.log(
      "WARN  Alert.alert still present in: " + hits.join(", ") + " — prefer confirmDialog/alertDialog"
    );
  } else {
    console.log("PASS  no in-app Alert.alert left in src/screens");
  }
}

console.log("\nRESULT: " + passed + " passed, " + failed + " failed");
process.exitCode = failed > 0 ? 1 : 0;
