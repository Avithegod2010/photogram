// Cross-platform review-probe runner.
//
// Bundles scripts/probe/probe.ts with the real esbuild JS API (no win32 binary
// path), aliases every native module to a stub, then runs:
//   1. the probe            (data/ML/logic checks against the real modules)
//   2. static-checks.cjs    (tsc-invisible guards: glyphs, native APIs, plugins)
//   3. tsc --noEmit
//
// Usage: node scripts/probe/build.mjs [--skip-tsc]
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
process.chdir(root);

const STUB = (name) => path.join(here, "stubs", `${name}.ts`);
const ALIASES = {
  "expo-sqlite": STUB("expo-sqlite"),
  "expo-file-system": STUB("expo-file-system"),
  "expo-file-system/legacy": STUB("expo-file-system-legacy"),
  "expo-image-manipulator": STUB("expo-image-manipulator"),
  "expo-media-library": STUB("expo-media-library"),
  "expo-media-library/legacy": STUB("expo-media-library-legacy"),
  "expo-constants": STUB("expo-constants"),
  "expo-crypto": STUB("expo-crypto"),
  "expo-document-picker": STUB("expo-document-picker"),
  "expo-network": STUB("expo-network"),
  "react-native": STUB("react-native"),
  "react-native-tdlib": STUB("react-native-tdlib"),
  "react-native-mmkv": STUB("react-native-mmkv"),
  "react-native-fast-tflite": STUB("react-native-fast-tflite"),
};

const outDir = path.join(here, ".build");
mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "probe.cjs");

console.log("• bundling probe");
await build({
  entryPoints: [path.join(here, "probe.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  define: { __DEV__: "true" },
  alias: ALIASES,
  logLevel: "warning",
});

const run = (cmd, args, label) => {
  console.log(`• ${label}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: root });
  if (res.status !== 0) {
    console.error(`\nFAILED: ${label}`);
    process.exit(res.status ?? 1);
  }
};

run(process.execPath, [outfile], "probe");
run(process.execPath, [path.join(here, "static-checks.cjs")], "static checks");

if (!process.argv.includes("--skip-tsc")) {
  // Run the local TypeScript compiler directly: no npx / shell quirks on Windows.
  run(
    process.execPath,
    [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"],
    "tsc"
  );
}

console.log("\nALL GREEN");
