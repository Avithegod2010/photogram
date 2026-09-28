import type * as NotificationsModule from "expo-notifications";
import { getDb } from "../db";
import { uploadsMmkv, useUploadStore } from "../store/uploadStore";
import { useSettingsStore } from "../store/settingsStore";

// v0.16 Notifications (strictly opt-in). Two local notification types:
//  - "Backup finished" when the upload queue drains with new completions.
//  - "On this day" at most once per day, on the first in-app check after 09:00.
// Nothing fires unless the master toggle is on. Delivery happens while the app
// is running (the worker and this loop are in-process) — stated honestly in the
// CHANGELOG rather than promising OS-scheduled alarms.

// expo-notifications' native module only exists after the next gradle rebuild —
// the installed APK predates it. Soft-require (same pattern as expo-battery in
// uploader.ts) so a missing module means "notifications unavailable" instead of
// crashing the app at import.
function notifications(): typeof NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolved = require("expo-notifications") as typeof NotificationsModule;
    if (typeof resolved?.scheduleNotificationAsync !== "function") return null;
    if (!handlerSet) {
      resolved.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      handlerSet = true;
    }
    return resolved;
  } catch {
    return null;
  }
}

let handlerSet = false;
let loopStarted = false;
let channelsReady = false;

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function dayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Android 8+ needs channels, and the Android 13 permission prompt only appears
// once at least one channel exists — create them BEFORE requesting.
async function ensureChannels(n: typeof NotificationsModule): Promise<void> {
  if (channelsReady) return;
  await n.setNotificationChannelAsync("backup", {
    name: "Backup",
    importance: n.AndroidImportance.DEFAULT,
  });
  await n.setNotificationChannelAsync("memories", {
    name: "Memories",
    importance: n.AndroidImportance.DEFAULT,
  });
  channelsReady = true;
}

// Called when the owner turns the master toggle on. Returns whether the OS
// permission was granted; the caller reverts the toggle when it was not.
export async function enableNotifications(): Promise<boolean> {
  const n = notifications();
  if (!n) return false;
  try {
    await ensureChannels(n);
    const perms = await n.requestPermissionsAsync();
    return !!perms.granted;
  } catch {
    return false;
  }
}

async function post(channelId: string, title: string, body: string): Promise<void> {
  const n = notifications();
  if (!n) return;
  try {
    await n.scheduleNotificationAsync({
      content: { title, body },
      // channelId is only accepted on trigger inputs, so "immediate" is a
      // 1-second time-interval trigger rather than a null trigger.
      trigger: {
        type: n.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        channelId,
      },
    });
  } catch {}
}

// --- Backup finished ----------------------------------------------------------

function lastNotifiedDone(): number {
  try {
    const raw = uploadsMmkv.getString("notify_last_done");
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function setLastNotifiedDone(n: number): void {
  try {
    uploadsMmkv.set("notify_last_done", String(n));
  } catch {}
}

function watchBackupFinished(): void {
  useUploadStore.subscribe((state, prev) => {
    const drained = prev.pending > 0 && state.pending === 0 && !state.active;
    if (!drained) return;
    if (state.done <= lastNotifiedDone()) return;
    const { notificationsEnabled, notifyBackupFinished } = useSettingsStore.getState();
    if (!notificationsEnabled || !notifyBackupFinished) return;
    const fresh = state.done - lastNotifiedDone();
    setLastNotifiedDone(state.done);
    void post(
      "backup",
      "Backup finished",
      `${fresh} item${fresh === 1 ? "" : "s"} safely uploaded to Telegram.`
    );
  });
}

// --- On this day ---------------------------------------------------------------

async function runOnThisDayCheck(): Promise<void> {
  const { notificationsEnabled, notifyOnThisDay } = useSettingsStore.getState();
  if (!notificationsEnabled || !notifyOnThisDay) return;
  const now = new Date();
  if (now.getHours() < 9) return;
  try {
    if (uploadsMmkv.getString("notify_onthisday_day") === dayKey()) return;
  } catch {}

  const thisYear = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number; y: number | null }>(
      `SELECT COUNT(*) AS c, MAX(CAST(strftime('%Y', taken_at / 1000, 'unixepoch') AS INTEGER)) AS y
       FROM media
       WHERE visibility = 'visible'
         AND CAST(strftime('%Y', taken_at / 1000, 'unixepoch') AS INTEGER) < ?
         AND CAST(strftime('%m', taken_at / 1000, 'unixepoch') AS INTEGER) = ?
         AND CAST(strftime('%d', taken_at / 1000, 'unixepoch') AS INTEGER) = ?
         AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)`,
      [thisYear, m, d]
    );
    const count = row?.c ?? 0;
    if (count > 0 && row?.y) {
      const years = thisYear - row.y;
      await post(
        "memories",
        "On this day",
        `${count} photo${count === 1 ? "" : "s"} from this day in ${row.y}${years > 1 ? ` (${years} years ago)` : ""}.`
      );
    }
    try {
      uploadsMmkv.set("notify_onthisday_day", dayKey());
    } catch {}
  } catch {}
}

// Called once from App.tsx when auth reaches "ready". Idempotent.
export function startNotifyLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  watchBackupFinished();
  setTimeout(() => void runOnThisDayCheck(), 20_000);
  setInterval(() => void runOnThisDayCheck(), CHECK_INTERVAL_MS);
}
