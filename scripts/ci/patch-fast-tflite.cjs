#!/usr/bin/env node
/**
 * Makes react-native-fast-tflite cheap to compile on CI as well as on the 8 GB
 * dev machine.
 *
 * Upstream compiles its debug variant with `-O1 -g`; with debug info a single
 * TFLite header translation unit can need >2 GB of commit, and clang aborts with
 * "LLVM ERROR: out of memory". The flag set below ships the same code without
 * debug symbols. It is applied locally by hand (docs/NATIVE-REAPPLY.md §0) and by
 * this script in CI, because node_modules is not in the repository.
 *
 * Idempotent: running it twice changes nothing.
 */
const fs = require("node:fs");
const path = require("node:path");

const FLAGS = '-O1 -g0 -fno-var-tracking';
const gradlePath = path.join(
  process.cwd(),
  "node_modules",
  "react-native-fast-tflite",
  "android",
  "build.gradle"
);

if (!fs.existsSync(gradlePath)) {
  console.log("patch-fast-tflite: module not installed, nothing to do");
  process.exit(0);
}

const source = fs.readFileSync(gradlePath, "utf8");
if (source.includes(FLAGS)) {
  console.log("patch-fast-tflite: already patched");
  process.exit(0);
}

// Match the debug block's cppFlags line, whatever it currently says.
const patched = source.replace(
  /(debug\s*\{[^}]*?cppFlags\s+)("[^"]*"|'[^']*')/,
  (_match, head) => `${head}"${FLAGS}"`
);

if (patched === source) {
  console.error(
    "patch-fast-tflite: could not find the debug cppFlags line — check react-native-fast-tflite/android/build.gradle"
  );
  process.exit(1);
}

fs.writeFileSync(gradlePath, patched);
console.log(`patch-fast-tflite: debug cppFlags set to ${FLAGS}`);
