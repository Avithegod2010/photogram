import {
  assignFacesToPerson,
  createPerson,
  getMeta,
  listFacesNeedingEmbedding,
  listMediaMissingFaces,
  listUngroupedEmbeddings,
  replaceFaceSamples,
  setFaceEmbedding,
  setMeta,
  DetectedFaceBox,
} from "../db/queries";
import { bytesToF32, detectFaces, embedFace, f32ToBytes } from "./faces";
import { isModelDownloaded } from "./faceModels";
import { useSettingsStore } from "../store/settingsStore";

// v0.35 People & Pets step 2: the on-device face pipeline.
//  - backfillFaces: makes detection + embeddings cover photos ALREADY in the
//    library (the scanner only handles rows it encounters). Resumable cursors
//    live in meta, exactly like the integrity walk; both phases are
//    chunked/cancelable and safe to re-run.
//  - runClustering: union-find over cosine similarity of the embeddings — the
//    junk sweep's same-day clustering pattern, without the day buckets. Only
//    samples with person_id NULL participate, so named people are frozen.

const DETECT_CURSOR = "faces_detect_cursor";
const EMBED_CURSOR = "faces_embed_cursor";
const DETECT_BATCH = 40;
const EMBED_BATCH = 20;

// Conservative on purpose: merging two different people is worse than missing
// a match (merges are manual anyway, and a too-tight threshold just leaves
// faces ungrouped where a later batch can still pick them up).
export const FACE_COSINE_THRESHOLD = 0.6;

export interface BackfillProgress {
  detectDone: boolean; // every library photo has face samples (or a sentinel)
  embedDone: boolean; // every detected face has an embedding for this model
  detectionReady: boolean; // native detection module available
  modelReady: boolean; // a model is chosen + downloaded
  processed: number;
}

export async function backfillFaces(
  onProgress?: (progress: BackfillProgress) => void,
  cancelRef?: { cancelled: boolean },
  budget = 300
): Promise<BackfillProgress> {
  const progress: BackfillProgress = {
    detectDone: false,
    embedDone: false,
    detectionReady: true,
    modelReady: false,
    processed: 0,
  };

  // --- phase 1: detection for photos without samples ---
  let cursor = Number((await getMeta(DETECT_CURSOR)) ?? 0);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  for (;;) {
    if (cancelRef?.cancelled) break;
    const batch = await listMediaMissingFaces(cursor, DETECT_BATCH);
    if (batch.length === 0) {
      await setMeta(DETECT_CURSOR, "0");
      progress.detectDone = true;
      break;
    }
    let stopped = false;
    for (const row of batch) {
      if (cancelRef?.cancelled) break;
      const faces: DetectedFaceBox[] | null = await detectFaces(row.thumb_uri);
      if (faces === null) {
        // Native module missing — nothing can be detected this run. Do not
        // advance the cursor; the next run retries.
        progress.detectionReady = false;
        stopped = true;
        break;
      }
      await replaceFaceSamples(row.id, faces);
      cursor = row.id;
      progress.processed++;
      await setMeta(DETECT_CURSOR, String(cursor));
      if (progress.processed % 10 === 0) onProgress?.({ ...progress });
    }
    if (stopped) break;
    onProgress?.({ ...progress });
  }

  // --- phase 2: embeddings for detected faces under the chosen model ---
  const modelId = useSettingsStore.getState().faceModelId;
  if (!modelId || !(await isModelDownloaded(modelId))) {
    onProgress?.({ ...progress });
    return progress;
  }
  progress.modelReady = true;
  let embedCursor = Number((await getMeta(EMBED_CURSOR)) ?? 0);
  if (!Number.isFinite(embedCursor) || embedCursor < 0) embedCursor = 0;
  for (;;) {
    if (cancelRef?.cancelled) break;
    const faces = await listFacesNeedingEmbedding(embedCursor, EMBED_BATCH, modelId);
    if (faces.length === 0) {
      await setMeta(EMBED_CURSOR, "0");
      progress.embedDone = true;
      break;
    }
    for (const face of faces) {
      if (cancelRef?.cancelled) break;
      try {
        const embedding = await embedFace(
          face.thumb_uri,
          { x: face.box_x, y: face.box_y, w: face.box_w, h: face.box_h },
          modelId
        );
        // Zero-length BLOB = "tried, failed" sentinel so one bad crop can
        // never stall the pass (mirrors the phash '' sentinel).
        await setFaceEmbedding(face.sample_id, embedding ? f32ToBytes(embedding) : new Uint8Array(0), modelId);
      } catch {
        await setFaceEmbedding(face.sample_id, new Uint8Array(0), modelId);
      }
      embedCursor = face.sample_id;
      progress.processed++;
      await setMeta(EMBED_CURSOR, String(embedCursor));
      if (progress.processed % 5 === 0) onProgress?.({ ...progress });
    }
    onProgress?.({ ...progress });
  }
  return progress;
}

export interface ClusterProgress {
  groupedFaces: number;
  peopleCreated: number;
}

// Cosine similarity over L2-normalized embeddings; union-find groups samples
// at or above FACE_COSINE_THRESHOLD. Groups of 2+ become unnamed people;
// singles stay ungrouped (a later batch can merge them manually).
export async function runClustering(
  onProgress?: (progress: ClusterProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<ClusterProgress> {
  const rows = await listUngroupedEmbeddings();
  const vectors: { sampleId: number; vec: Float32Array; norm: number }[] = [];
  for (const row of rows) {
    const bytes = row.embedding ?? new Uint8Array(0);
    if (bytes.length === 0) continue; // failed-embed sentinel
    const vec = bytesToF32(bytes);
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    vectors.push({ sampleId: row.sample_id, vec, norm });
  }

  const parent = vectors.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      if (cancelRef?.cancelled) break;
      const a = vectors[i];
      const b = vectors[j];
      let dot = 0;
      const dim = Math.min(a.vec.length, b.vec.length);
      for (let k = 0; k < dim; k++) dot += a.vec[k] * b.vec[k];
      const similarity = dot / (a.norm * b.norm);
      if (similarity >= FACE_COSINE_THRESHOLD) union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < vectors.length; i++) {
    const root = find(i);
    const list = clusters.get(root) ?? [];
    list.push(vectors[i].sampleId);
    clusters.set(root, list);
  }

  let groupedFaces = 0;
  let peopleCreated = 0;
  for (const sampleIds of clusters.values()) {
    if (sampleIds.length < 2) continue;
    const personId = await createPerson(null);
    await assignFacesToPerson(sampleIds, personId);
    groupedFaces += sampleIds.length;
    peopleCreated++;
    onProgress?.({ groupedFaces, peopleCreated });
  }
  return { groupedFaces, peopleCreated };
}
