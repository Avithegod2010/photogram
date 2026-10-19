import {
  assignFacesToPerson,
  createPerson,
  getMeta,
  listFaceRejections,
  listFacesNeedingEmbedding,
  listAllEmbeddingsForClustering,
  listMediaMissingFaces,
  listPeopleFull,
  listCandidateSourceFaces,
  listPersonFacesForCandidates,
  replaceFaceSamples,
  setFaceEmbedding,
  setMeta,
  mergePeopleInto,
  countFacesOfPerson,
  deletePerson,
  rejectSamplesFromPerson,
  splitSamplesOff,
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
  attachedToNamed: number;
}

// v2 engine: (1) AFFINITY ATTACH — unassigned embeddings are compared against
// NAMED people's members; ≥ that person's sensitivity (NULL → global default)
// and no blocked pair wins → the face joins that named person. This is where
// per-person sensitivity lives. (2) UNION-FIND over unassigned pairs only,
// with blocked pairs (the manual "Not X" / "Split off" learning) as hard
// non-edges; groups of 2+ become NEW unnamed people. Named people are frozen —
// only the attach step can give them faces.
export async function runClustering(
  onProgress?: (progress: ClusterProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<ClusterProgress> {
  const rows = await listAllEmbeddingsForClustering();
  const vectors: { sampleId: number; personId: number | null; vec: Float32Array; norm: number }[] = [];
  for (const row of rows) {
    const bytes = row.embedding ?? new Uint8Array(0);
    if (bytes.length === 0) continue; // failed-embed sentinel
    const vec = bytesToF32(bytes);
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    vectors.push({ sampleId: row.sample_id, personId: row.person_id, vec, norm });
  }
  const blockedPairs = new Set(
    (await listFaceRejections()).map((r) => pairKey(r.sample_id, r.blocked_sample_id))
  );
  const isBlocked = (aSample: number, bSample: number) =>
    blockedPairs.has(pairKey(aSample, bSample));

  function cosine(a: (typeof vectors)[number], b: (typeof vectors)[number]): number {
    let dot = 0;
    const dim = Math.min(a.vec.length, b.vec.length);
    for (let k = 0; k < dim; k++) dot += a.vec[k] * b.vec[k];
    return dot / (a.norm * b.norm);
  }

  const progress: ClusterProgress = { groupedFaces: 0, peopleCreated: 0, attachedToNamed: 0 };

  // --- phase 1: affinity attach to NAMED people ---
  const people = await listPeopleFull();
  const named = people.filter((p) => p.name !== null);
  if (named.length > 0) {
    const bySample = new Map(vectors.map((v) => [v.sampleId, v]));
    for (const person of named) {
      const reps = vectors.filter((v) => v.personId === person.id);
      if (reps.length === 0) continue;
      const threshold = person.sensitivity ?? FACE_COSINE_THRESHOLD;
      for (const v of vectors) {
        if (cancelRef?.cancelled) break;
        if (v.personId !== null) continue;
        if (reps.some((rep) => isBlocked(v.sampleId, rep.sampleId))) continue;
        let best = -1;
        for (const rep of reps) {
          const sim = cosine(v, rep);
          if (sim > best) best = sim;
        }
        if (best >= threshold) {
          await assignFacesToPerson([v.sampleId], person.id);
          v.personId = person.id;
          progress.attachedToNamed++;
        }
      }
    }
    onProgress?.({ ...progress });
  }

  // --- phase 2: new clusters among still-unassigned samples ---
  const parent = vectors.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const unassignedIdx: number[] = [];
  for (let i = 0; i < vectors.length; i++) if (vectors[i].personId === null) unassignedIdx.push(i);
  for (let x = 0; x < unassignedIdx.length; x++) {
    for (let y = x + 1; y < unassignedIdx.length; y++) {
      if (cancelRef?.cancelled) break;
      const a = vectors[unassignedIdx[x]];
      const b = vectors[unassignedIdx[y]];
      if (a.personId !== null || b.personId !== null) continue; // attached during phase 1
      if (isBlocked(a.sampleId, b.sampleId)) continue;
      if (cosine(a, b) >= FACE_COSINE_THRESHOLD) union(unassignedIdx[x], unassignedIdx[y]);
    }
  }

  const clusters = new Map<number, number[]>();
  for (const i of unassignedIdx) {
    if (vectors[i].personId !== null) continue;
    const root = find(i);
    const list = clusters.get(root) ?? [];
    list.push(vectors[i].sampleId);
    clusters.set(root, list);
  }

  for (const sampleIds of clusters.values()) {
    if (sampleIds.length < 2) continue;
    const personId = await createPerson(null);
    await assignFacesToPerson(sampleIds, personId);
    progress.groupedFaces += sampleIds.length;
    progress.peopleCreated++;
    onProgress?.({ ...progress });
  }
  return progress;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// --- v2 person management (merge/split/dismiss) ---------------------------------

export interface PersonOpsResult {
  mergedInto: number | null; // target id when a merge happened
  leftCount: number; // faces that left the source person
  deletedSource: boolean;
}

// Merge person B INTO person A; A keeps its name; B's row is deleted.
export async function mergePeople(targetId: number, sourceId: number): Promise<PersonOpsResult> {
  await mergePeopleInto(targetId, sourceId);
  return { mergedInto: targetId, leftCount: 0, deletedSource: true };
}

// Split: the chosen faces leave their person; the person row dies only when
// nothing is left (its samples were all split away).
export async function splitOffFaces(sampleIds: number[], personId: number): Promise<PersonOpsResult> {
  await splitSamplesOff(sampleIds, personId);
  const left = await countFacesOfPerson(personId);
  if (left === 0) await deletePerson(personId);
  return { mergedInto: null, leftCount: sampleIds.length, deletedSource: left === 0 };
}

// "Not person X": faces leave X AND are blocked from X's remaining members.
export async function dismissFacesFromPerson(sampleIds: number[], personId: number): Promise<PersonOpsResult> {
  await rejectSamplesFromPerson(sampleIds, personId);
  const left = await countFacesOfPerson(personId);
  if (left === 0) await deletePerson(personId);
  return { mergedInto: null, leftCount: sampleIds.length, deletedSource: left === 0 };
}

// --- v0.40: "Possible more of X" candidates -------------------------------------

export interface PersonCandidate {
  sampleId: number;
  mediaId: number;
  score: number;
}

// Ranks every UNASSIGNED face by its best cosine against any face already in
// the person. The person's own sensitivity sets the suggestion floor
// (threshold / 2) so Strict people still get a wide enough net to pick from;
// nothing is attached automatically — attaching here is always a tap. Blocked
// pairs never appear, whatever their cosine.
export async function listPersonCandidates(
  personId: number,
  sensitivity: number | null = null
): Promise<PersonCandidate[]> {
  const [members, sources, rejections] = await Promise.all([
    listPersonFacesForCandidates(personId),
    listCandidateSourceFaces(),
    listFaceRejections(),
  ]);
  const floor = (sensitivity ?? FACE_COSINE_THRESHOLD) / 2;
  if (members.length === 0 || sources.length === 0) return [];
  const blocked = new Set(rejections.map((r) => pairKey(r.sample_id, r.blocked_sample_id)));

  const memberVecs: { sampleId: number; vec: Float32Array; norm: number }[] = [];
  for (const m of members) {
    if (m.embedding.byteLength === 0) continue;
    const vec = bytesToF32(m.embedding);
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) memberVecs.push({ sampleId: m.sampleId, vec, norm });
  }
  if (memberVecs.length === 0) return [];

  const best = new Map<number, PersonCandidate>();
  for (const s of sources) {
    if (s.embedding.byteLength === 0) continue;
    const sv = bytesToF32(s.embedding);
    let snorm = 0;
    for (let i = 0; i < sv.length; i++) snorm += sv[i] * sv[i];
    snorm = Math.sqrt(snorm);
    if (snorm === 0) continue;
    let top = 0;
    for (const mv of memberVecs) {
      if (blocked.has(pairKey(s.sampleId, mv.sampleId))) continue;
      let dot = 0;
      const dim = Math.min(sv.length, mv.vec.length);
      for (let k = 0; k < dim; k++) dot += sv[k] * mv.vec[k];
      const score = dot / (snorm * mv.norm);
      if (score > top) top = score;
    }
    if (top < floor) continue;
    const prev = best.get(s.sampleId);
    if (!prev || prev.score < top) best.set(s.sampleId, { sampleId: s.sampleId, mediaId: s.mediaId, score: top });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 20);
}
