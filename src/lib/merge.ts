import { getMediaByIds, setMediaVisibility } from "../db/queries";
import { DuplicateGroup } from "./similar";

// v0.36 duplicate merge: the keeper stays; every other member of the group
// moves to Trash — the app's only reversible deletion path (visibility
// 'trashed' + trashed_at). The ≤30-day purge then cleans their local files
// AND Telegram copies through the proven purgeExpiredTrash route. No direct
// deletion happens here on purpose: merging must always be undoable, and the
// keeper keeps a full copy of the group's content.
export interface MergeOutcome {
  trashed: number;
  skipped: number;
  freedBytes: number;
}

// Returns all-zero when keeperId is not in the group (no partial merges).
export async function mergeDuplicateGroup(
  group: DuplicateGroup,
  keeperId: number,
  onProgress?: (trashed: number, total: number) => void
): Promise<MergeOutcome> {
  const outcome: MergeOutcome = { trashed: 0, skipped: 0, freedBytes: 0 };
  if (!group.items.some((r) => r.id === keeperId)) return outcome;
  const others = group.items.filter((r) => r.id !== keeperId);
  // Fresh read: the screen's group snapshot may predate a trash action (or a
  // previous merge). Re-checking visibility here makes re-runs true no-ops.
  const fresh = await getMediaByIds(others.map((r) => r.id));
  for (const row of fresh) {
    if (row.visibility === "trashed") {
      outcome.skipped++;
      continue;
    }
    await setMediaVisibility(row.id, "trashed", "merge");
    outcome.trashed++;
    outcome.freedBytes += row.byte_size;
    onProgress?.(outcome.trashed, others.length);
  }
  return outcome;
}
