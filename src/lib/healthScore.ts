// v0.55 backup health score.
//
// One number (0-100) the owner can trust at a glance, plus plain-English
// reasons and the action that would raise it. Pure function so the probe can
// exercise every combination without a database or a device.
//
// Deliberate choices:
// - "never checked" is NOT scored as broken; it costs a small amount and adds
//   an explicit reason, because an unchecked backup is not a proven one.
// - The score never hides a problem: every penalty has a matching reason line.
// - A huge queue only costs a little: it is progress, not damage.

export interface HealthSnapshot {
  totalVisible: number;
  synced: number;
  pending: number; // local + queued + uploading
  failed: number;
  integrityBroken: number | null; // null = no completed pass yet
  integrityFinishedAt: number | null;
  lastUploadAt: number | null;
}

export type HealthGrade = "excellent" | "good" | "fair" | "at-risk";
export type HealthActionKey = "backup" | "retry" | "integrity";

export interface HealthAction {
  key: HealthActionKey;
  label: string;
}

export interface HealthResult {
  score: number;
  grade: HealthGrade;
  headline: string;
  reasons: string[];
  actions: HealthAction[];
}

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / DAY));
}

export function gradeFor(score: number): HealthGrade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 50) return "fair";
  return "at-risk";
}

export function computeHealth(s: HealthSnapshot, now = Date.now()): HealthResult {
  const total = Math.max(0, s.totalVisible);
  const synced = Math.min(total, Math.max(0, s.synced));
  if (total === 0) {
    return {
      score: 0,
      grade: "fair",
      headline: "Nothing scanned yet",
      reasons: ["Run a scan from the gallery to index this phone's photos."],
      actions: [],
    };
  }

  const missing = Math.max(0, total - synced);
  const pct = Math.round((synced / total) * 100);
  const reasons: string[] = [`${synced}/${total} backed up (${pct}%).`];
  const actions: HealthAction[] = [];

  let score = 100;

  if (missing > 0) {
    score -= Math.min(55, Math.round((missing / total) * 55));
    reasons.push(`${missing} item${missing === 1 ? "" : "s"} still to back up.`);
    actions.push({ key: "backup", label: "Review the queue" });
  }

  if (s.pending > 0) {
    score -= Math.min(10, Math.floor(s.pending / 100));
    reasons.push(`${s.pending} item${s.pending === 1 ? "" : "s"} in the upload queue.`);
  }

  if (s.failed > 0) {
    score -= Math.min(20, s.failed * 2);
    reasons.push(
      `${s.failed} upload${s.failed === 1 ? "" : "s"} failed — they are retried automatically, but check if it repeats.`
    );
    actions.push({ key: "retry", label: "Open diagnostics" });
  }

  if (s.integrityFinishedAt === null) {
    score -= 5;
    reasons.push("Backup integrity has never been checked — a pass proves the files are really in Telegram.");
    actions.push({ key: "integrity", label: "Run an integrity check" });
  } else if ((s.integrityBroken ?? 0) > 0) {
    const broken = s.integrityBroken ?? 0;
    score -= Math.min(25, broken * 3);
    reasons.push(`${broken} item${broken === 1 ? "" : "s"} could not be found in Telegram.`);
    actions.push({ key: "integrity", label: "See what is missing" });
  }

  if (s.lastUploadAt === null) {
    score -= 5;
    reasons.push("Nothing has been uploaded yet.");
  } else {
    const ageDays = daysAgo(s.lastUploadAt, now);
    if (ageDays > 30) {
      score -= 10;
      reasons.push(`Last successful upload was ${ageDays} days ago.`);
    } else if (ageDays > 7) {
      score -= 5;
      reasons.push(`Last successful upload was ${ageDays} days ago.`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let headline: string;
  if (score >= 90 && missing === 0 && (s.failed ?? 0) === 0 && (s.integrityBroken ?? 0) === 0) {
    headline = "Your library is fully backed up";
  } else if ((s.integrityBroken ?? 0) > 0) {
    headline = `${s.integrityBroken} item${s.integrityBroken === 1 ? "" : "s"} missing in Telegram`;
  } else if (s.failed > 0) {
    headline = `${s.failed} upload${s.failed === 1 ? "" : "s"} failed`;
  } else if (missing > 0) {
    headline = `${missing} item${missing === 1 ? "" : "s"} left to back up`;
  } else if (s.integrityFinishedAt === null) {
    headline = "Backed up — integrity not checked yet";
  } else {
    headline = "Backup is healthy";
  }

  return { score, grade: gradeFor(score), headline, reasons, actions };
}
