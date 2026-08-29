const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkgDir = path.join(root, "node_modules", "react-native-tdlib");

const patches = [
  {
    src: path.join(root, "patches", "react-native-tdlib.react-native.config.js"),
    dst: path.join(pkgDir, "react-native.config.js"),
    why: "CLI v20+ schema fix, keeps TdLibPackage import",
  },
  {
    src: path.join(root, "patches", "react-native-tdlib.android.build.gradle"),
    dst: path.join(pkgDir, "android", "build.gradle"),
    why: "compileSdk/targetSdk 34 -> 36 (Platform 34 not installed; downloads stall on this network)",
  },
];

try {
  if (fs.existsSync(pkgDir)) {
    for (const p of patches) {
      if (fs.existsSync(p.src)) {
        fs.copyFileSync(p.src, p.dst);
        console.log(`[patch-tdlib] applied ${path.basename(p.dst)} (${p.why})`);
      }
    }
  }
} catch (e) {
  console.warn("[patch-tdlib] skipped:", e.message);
}
