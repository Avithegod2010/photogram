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

// Anchor-insert patches: insert a snippet before a stable anchor line, only
// when the target file doesn't already contain the marker. Idempotent by
// construction (marker check), so npm postinstall can re-run safely.
const insertPatches = [
  {
    file: path.join(pkgDir, "android", "src", "main", "java", "com", "reactnativetdlib", "tdlibclient", "TdLibModule.java"),
    marker: "public void getForumTopics(",
    anchor: "    @ReactMethod\n    public void getMessageThreadHistory(double chatId,",
    snippet:
`    @ReactMethod
    public void getForumTopics(double chatId, int limit, Promise promise) {
        try {
            if (client == null) {
                promise.reject("CLIENT_NOT_INITIALIZED", "TDLib client is not initialized");
                return;
            }
            TdApi.GetForumTopics request = new TdApi.GetForumTopics(
                (long) chatId,
                "",
                0,
                0,
                0,
                Math.max(limit, 1)
            );
            client.send(request, object -> {
                WritableMap result = Arguments.createMap();
                result.putString("raw", gson.toJson(object));
                promise.resolve(result);
            });
        } catch (Exception e) {
            promise.reject("GET_FORUM_TOPICS_ERROR", e.getMessage());
        }
    }

`,
    why: "getForumTopics typed wrapper (S9 topic sub-albums; raw td_json_client_send is fire-and-forget)",
  },
  {
    file: path.join(pkgDir, "index.js"),
    marker: "getForumTopics: TdLibModule.getForumTopics,",
    anchor: "  getMessageThreadHistory: TdLibModule.getMessageThreadHistory,\n",
    snippet: "  getForumTopics: TdLibModule.getForumTopics,\n",
    why: "register getForumTopics in the JS export object",
  },
  {
    file: path.join(pkgDir, "index.d.ts"),
    marker: "export function getForumTopics(",
    anchor: "  export function getMessageThreadHistory(",
    snippet:
`  export function getForumTopics(
    chatId: number,
    limit: number,
  ): Promise<TdRawResult>;
`,
    why: "declare getForumTopics in the typings",
  },
  {
    file: path.join(pkgDir, "index.d.ts"),
    marker: "getForumTopics: typeof getForumTopics;",
    anchor: "    getMessageThreadHistory: typeof getMessageThreadHistory;\n",
    snippet: "    getForumTopics: typeof getForumTopics;\n",
    why: "register getForumTopics on the default-export typings object",
  },
  {
    file: path.join(pkgDir, "android", "src", "main", "java", "com", "reactnativetdlib", "tdlibclient", "TdLibModule.java"),
    marker: "public void getForumTopicHistory(",
    anchor: "    @ReactMethod\n    public void getMessageThreadHistory(double chatId,",
    snippet:
`    @ReactMethod
    public void getForumTopicHistory(double chatId, int forumTopicId, double fromMessageId, int offset, int limit, Promise promise) {
        try {
            if (client == null) {
                promise.reject("CLIENT_NOT_INITIALIZED", "TDLib client is not initialized");
                return;
            }
            TdApi.GetForumTopicHistory request = new TdApi.GetForumTopicHistory(
                (long) chatId,
                Math.max(forumTopicId, 1),
                (long) fromMessageId,
                offset,
                Math.max(limit, 1)
            );
            client.send(request, object -> {
                WritableMap result = Arguments.createMap();
                result.putString("raw", gson.toJson(object));
                promise.resolve(result);
            });
        } catch (Exception e) {
            promise.reject("GET_FORUM_TOPIC_HISTORY_ERROR", e.getMessage());
        }
    }

`,
    why: "getForumTopicHistory typed wrapper (S9 topics: addresses topics by forumTopicId without needing root messages loaded)",
  },
  {
    file: path.join(pkgDir, "index.js"),
    marker: "getForumTopicHistory: TdLibModule.getForumTopicHistory,",
    anchor: "  getMessageThreadHistory: TdLibModule.getMessageThreadHistory,\n",
    snippet: "  getForumTopicHistory: TdLibModule.getForumTopicHistory,\n",
    why: "register getForumTopicHistory in the JS export object",
  },
  {
    file: path.join(pkgDir, "index.d.ts"),
    marker: "export function getForumTopicHistory(",
    anchor: "  export function getMessageThreadHistory(",
    snippet:
`  export function getForumTopicHistory(
    chatId: number,
    forumTopicId: number,
    fromMessageId: number,
    offset: number,
    limit: number,
  ): Promise<TdRawResult>;
`,
    why: "declare getForumTopicHistory in the typings",
  },
  {
    file: path.join(pkgDir, "index.d.ts"),
    marker: "getForumTopicHistory: typeof getForumTopicHistory;",
    anchor: "    getMessageThreadHistory: typeof getMessageThreadHistory;\n",
    snippet: "    getForumTopicHistory: typeof getForumTopicHistory;\n",
    why: "register getForumTopicHistory on the default-export typings object",
  },
];

// Replace patches: fix an upstream bug by swapping an exact wrong snippet for
// the corrected one. Marker IS the wrong text — once replaced it's gone, so
// re-runs are no-ops (idempotent by construction).
const replacePatches = [
  {
    file: path.join(pkgDir, "android", "src", "main", "java", "com", "reactnativetdlib", "tdlibclient", "TdLibModule.java"),
    marker: "new TdApi.GetSupergroup((int) supergroupId)",
    replacement: "new TdApi.GetSupergroup((long) supergroupId)",
    why: "GetSupergroup.supergroupId is long in this TdApi — (int) cast overflows for supergroup ids > 2^31, breaking isForumChat (S9 topic detection)",
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
    for (const p of insertPatches) {
      if (!fs.existsSync(p.file)) continue;
      const content = fs.readFileSync(p.file, "utf8");
      if (content.includes(p.marker)) continue; // already applied
      if (!content.includes(p.anchor)) {
        console.warn(`[patch-tdlib] anchor missing in ${path.basename(p.file)}, skipped (${p.why})`);
        continue;
      }
      fs.writeFileSync(p.file, content.replace(p.anchor, p.snippet + p.anchor));
      console.log(`[patch-tdlib] inserted into ${path.basename(p.file)} (${p.why})`);
    }
    for (const p of replacePatches) {
      if (!fs.existsSync(p.file)) continue;
      const content = fs.readFileSync(p.file, "utf8");
      if (!content.includes(p.marker)) continue; // already fixed (marker gone)
      fs.writeFileSync(p.file, content.replace(p.marker, p.replacement));
      console.log(`[patch-tdlib] replaced in ${path.basename(p.file)} (${p.why})`);
    }
  }
} catch (e) {
  console.warn("[patch-tdlib] skipped:", e.message);
}
