# People & Pets — Feasibility Plan (doc only, no code written)

_Status: plan for owner review, authored 2026-10-04 after the Vibe search v1 work (schema v12
`ml_labels`). Every library fact below was checked against npm/GitHub on that date; anything that
could not be verified is marked **unverified** rather than guessed. NO dependency has been
installed and NO code exists for this feature yet._

---

## 1. Candidate dependencies (facts, checked 2026-10-04)

### 1a. Face DETECTION — `@react-native-ml-kit/face-detection` v2.0.1 (verified)

- Same author family as the two ML Kit modules Photogram already ships
  (`text-recognition` 2.0.0, `image-labeling` 2.0.0): classic NativeModule, autolinked by
  expo autolinking, runs via the New-Architecture interop layer. **The two existing siblings are
  proven working on this exact stack (device-built APK, 687 OCR rows indexed), which is the
  strongest compatibility evidence available** for the third member of the same family.
- npm: `version = 2.0.1`, "React Native On-Device Face Detection w/ Google ML Kit".
- API: `import FaceDetection from '@react-native-ml-kit/face-detection'`;
  `FaceDetection.detect(imageURL, options)` (async). Options include `landmarkMode` etc.
  (full result shape to be confirmed from its `index.ts` at integration time — same one-file
  pattern as image-labeling).
- Google ML Kit Face Detection detects **human faces only**. Pets need a different detector (§5).
- Integration cost: same soft-require + catch pattern as scanner.ts uses for OCR/labels — a
  missing native module can never crash the app (silently no-ops until the next gradle rebuild).

**Removed alternative (verified):** `expo-face-detector` no longer exists in Expo SDK 57 — its
docs page returns 404. The ML Kit module is the correct replacement.

### 1b. Face EMBEDDINGS — `react-native-fast-tflite` v3.0.1 (verified) + `react-native-nitro-modules`

- npm: `version = 3.0.1`, "High-performance TensorFlow Lite library for React Native, built with
  Nitro Modules". Peer deps: `react`, `react-native`, `react-native-nitro-modules`. Actively
  maintained (last publish 2026-04-21).
- Nitro Modules are built FOR the New Architecture (JSI HybridObjects) — the right direction for
  RN 0.86 / SDK 57. **Caveat (unverified):** the README states no explicit minimum RN version;
  actual RN 0.86 / SDK 57 / gradle compatibility can only be proven by a real device build. This
  is flagged as the #1 integration risk (§6).
- Install (per README): `npm i react-native-fast-tflite react-native-nitro-modules`; add
  `'tflite'` to `resolver.assetExts` in `metro.config.js`; an Expo config plugin exists
  (`enableAndroidGpuLibraries`) if GPU delegation is wanted later (CPU/`nnapi` works without it).
- API: `loadTensorflowModel(require('./model.tflite'), [])` → `model.run([input])` /
  `model.runSync([input])`; inputs/outputs are **raw ArrayBuffers** — tensor shapes are the
  app's responsibility (inspect in Netron; wrap output in `new Float32Array(...)`).
- Feeding raw pixels: Photogram already has the pieces — crop the face from the 320px thumbnail
  with expo-image-manipulator, read the bytes via `File.slice().arrayBuffer()`, decode
  RGBA with **jpeg-js** (already a dependency from the v0.19 editor), normalize per the model
  spec, build a `Float32Array`. No new decoding dependency needed.

### 1c. What this adds to the build

Two new native modules (face-detection + fast-tflite/nitro) → both land in the SAME pending
gradle rebuild pipeline as v0.16/v0.17/v0.23. No Expo SDK version changes; no config-plugin
changes needed for a CPU-only first version.

---

## 2. Embedding model options (OWNER MUST APPROVE ANY DOWNLOAD BEFORE BUNDLING)

| # | Model | Input | Embedding | Size | Source | License |
|---|-------|-------|-----------|------|--------|---------|
| A | **FaceNet (Keras-port .tflite)** — shipped ready-made in `shubham0204/FaceRecognition_With_FaceNet_Android` (repo Apache-2.0; weights lineage: nyoki-mtl/keras-facenet ← davidsandberg/facenet, MIT) | 160×160 RGB | 128-d | ~23 MB (to verify at download) | https://github.com/shubham0204/FaceRecognition_With_FaceNet_Android | Apache-2.0 repo; weight provenance needs a spot-check before bundling |
| B | **MobileFaceNet** — `sirius-ai/MobileFaceNet_TF` pretrained weights | 112×112 RGB | 192-d (verify at download) | 5.7 MB params; LFW 99.4+%; ~260 ms on an old MSM8976 CPU | https://github.com/sirius-ai/MobileFaceNet_TF | Apache-2.0 |
| C | InsightFace-derived tflite ports | varies | varies | varies | community conversions | **Generally NON-COMMERCIAL + training-data restrictions — do not bundle without explicit owner sign-off (recommend: avoid)** |

- **Recommendation: candidate A** — it ships an actual `.tflite` file (no TF1→tflite conversion
  step on the owner's PC, which candidate B requires) and the whole pipeline in that repo is
  documented for Android. Candidate B is the better long-term model (5× smaller, faster, higher
  LFW) but needs an offline conversion pass first.
- The model file would live in `assets/` (~5–23 MB APK growth) or be downloaded on first
  "People" enablement. Bundling is simpler and works offline from day one.
- **Rule (owner-agreed pattern):** the owner approves the exact file + URL before it is added.

---

## 3. Pipeline design (mirrors existing Photogram patterns)

```
scan pass (320px thumb)                     [scanner.ts, opt-in setting peopleTagsEnabled]
  └─ ML Kit face detect on thumb            [photos only in v1 — videos skip, like OCR/labels]
       └─ face_samples row (box, quality)   [schema v13]
embedding pass (rescan backfill for NULL embeddings)
  └─ crop face box from thumb (expo-image-manipulator, model input size)
       └─ jpeg-js decode → Float32Array (normalized) → fast-tflite run
            └─ face_samples.embedding BLOB
clustering (one shot per embedding pass, like junk.ts nearDuplicateFindings)
  └─ union-find over pairwise cosine similarity ≥ threshold (~0.6–0.7, tunable)
       └─ clusters → people rows (unnamed until the owner names them)
People screen
  └─ grid of people (cover face + count + "Unnamed N")
       └─ tap → all photos of that person (face_samples ⋈ media, visibility filters as usual)
            └─ rename / merge / remove-wrong-face (v1: rename only)
```

- Detection and embedding are **separate passes** so a missing/broken embedding module can never
  block detection, and each pass is resumable/idempotent exactly like the OCR/label/sweep
  backfills (`NULL` = not done yet; every rescan covers only what's missing).
- Clustering re-runs only when the count of embedded-but-unclustered faces changed; a new person
  never re-shuffles named clusters (named clusters are frozen; new faces join a named person only
  via a "merge" action in a later version).

## 4. Schema sketch (v13, additive — one migration, same rules as v12)

```sql
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,                      -- NULL = unnamed cluster ("Unnamed 3" in UI)
  cover_face_id INTEGER,          -- best-quality face for the grid tile
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS face_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES people(id),   -- NULL until clustered/named
  box_x REAL, box_y REAL, box_w REAL, box_h REAL,  -- normalized [0..1] on the thumb
  quality REAL,                              -- detector confidence
  embedding BLOB,                            -- Float32Array bytes; NULL = not embedded yet
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_face_samples_media ON face_samples (media_id);
CREATE INDEX IF NOT EXISTS idx_face_samples_person ON face_samples (person_id) WHERE person_id IS NOT NULL;
```

Storage math: ~2,800 faces × (512 B embedding + row overhead) ≈ **~2 MB** — trivial.

## 5. Compute budget (owner's library: ~1,850 photos, 133 videos)

| Step | Per item | Total |
|------|----------|-------|
| ML Kit face detect on 320px thumb | ~20–60 ms | 1,850 photos → **~1–2 min** (spread over scans) |
| Crop + decode + embed (112–160 px crop, CPU tflite) | ~30–80 ms | ~2,800 faces → **~2–4 min** |
| Union-find clustering (pairwise cosine, JS) | — | ~4M dot products of 128 floats → **seconds** |

Runs inside the existing scan/sweep chunking cadence (per-item try/catch, resumable cursor,
never blocks the UI thread beyond one item — same discipline as junk.ts). First full pass is
single-digit minutes; later scans only process new/missing rows.

## 6. Risks & open questions (owner decides)

1. **fast-tflite × RN 0.86 compat is UNVERIFIED until a device build** — highest-risk item. If
   Nitro fails to build, fallback options: (a) ML Kit-only "People" v0 (faces detected and shown
   per-photo but no grouping), or (b) reconsider TF.js (heavier JS runtime — not recommended).
2. **Model licensing:** candidate A's weight provenance (nyoki-mtl/keras-facenet) must be
   spot-checked before bundling; candidate C (InsightFace family) is treated as off-limits by
   default. Owner approves the file before it lands in `assets/`.
3. **Cluster-quality expectations:** LFW 99% ≠ family-album 99%. Small faces, profile angles,
   glasses, kids aging, and similar-looking relatives will mis-cluster. Plan for a "this is not
   X" tap (remove face from person) and a similarity threshold setting; v1 keeps rename-only and
   deliberately skips merge/split.
4. **Pets:** ML Kit detects human faces only. Recommendation: **defer pets**; the v0.23 smart
   tags already make "dog"/"cat" photos searchable by content — a "Pets" smart-album built on
   `ml_labels LIKE '%dog%' OR ml_labels LIKE '%cat%'` is a near-free v0 if wanted.
5. **Privacy:** everything stays on-device (detection, embeddings, clustering, names). Embeddings
   are one-way numeric vectors of face geometry, never uploaded; names live in local SQLite.
   This should be stated in the People screen's onboarding text and is consistent with
   PRIVACY.md's no-collection policy.
6. **Three passes, one setting:** people work should be its own opt-in (`peopleTagsEnabled`),
   independent from OCR/smart-tags toggles, so each scan pass can be reasoned about and
   debugged alone.

## 7. Ordered task breakdown (only after owner approves model + plan)

| # | Task | Acceptance check |
|---|------|------------------|
| T1 | `npm i react-native-fast-tflite react-native-nitro-modules` + metro `assetExts` + **gradle device build** | app boots, module imports resolve on device |
| T2 | Owner-approved model into `assets/` + load smoke test (run on a test crop, log embedding norm) | non-zero 128-float output |
| T3 | `@react-native-ml-kit/face-detection` install + soft-require wrapper in a new `src/lib/faces.ts` | same no-crash-without-build behavior as OCR/labels |
| T4 | Schema v13 (people + face_samples) via the MIGRATIONS pattern | migration on device, `meta.schema_version=13` |
| T5 | Detection pass in scanner.ts (photos only, `peopleTagsEnabled`, backfill `embedding IS NULL`) | rescan writes face rows; tsc clean |
| T6 | Embedding pass (crop→jpeg-js→fast-tflite) | embedding BLOBs written; failures caught per-face |
| T7 | Clustering (union-find cosine, junk.ts pattern) + people rows | rerun is idempotent; named clusters frozen |
| T8 | PeopleScreen + navigation route + rename action | tap person → their photos; rename persists |
| T9 | CHANGELOG + device verification checklist (mixed-angle family photos, relaunch idempotence) | checklist passes |

---

## Sources (checked 2026-10-04)

- npm registry: `@react-native-ml-kit/face-detection@2.0.1`, `react-native-fast-tflite@3.0.1`
  (+ README via GitHub).
- https://github.com/margelo/react-native-fast-tflite — install/API/config-plugin facts.
- https://github.com/shubham0204/FaceRecognition_With_FaceNet_Android — FaceNet .tflite pipeline
  (Apache-2.0).
- https://github.com/sirius-ai/MobileFaceNet_TF — MobileFaceNet weights (Apache-2.0, LFW 99.4+%).
- https://docs.expo.dev/versions/v57.0.0/sdk/facedetector/ — 404 (expo-face-detector removed).
- https://github.com/topics/mobilefacenet — survey of implementations.
