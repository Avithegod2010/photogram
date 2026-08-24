import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import TdLib from "react-native-tdlib";
import {
  deleteMediaRow,
  findExpiredTrash,
  getSyncedWithLocal,
  clearLocalUri,
} from "../db/queries";

export const TRASH_RETENTION_DAYS = 30;

export async function purgeExpiredTrash(): Promise<number> {
  const expired = await findExpiredTrash(TRASH_RETENTION_DAYS);
  let purged = 0;
  for (const row of expired) {
    if (row.remote_chat_id && row.remote_message_id && row.remote_message_id !== "0") {
      try {
        await TdLib.deleteMessages(Number(row.remote_chat_id), [Number(row.remote_message_id)], false);
      } catch {}
    }
    if (row.local_uri) {
      try {
        const file = new File(row.local_uri);
        if (file.exists) file.delete();
      } catch {}
    }
    try {
      await deleteMediaRow(row.id);
      purged++;
    } catch {}
  }
  return purged;
}

export async function countFreeableBytes(): Promise<{ count: number; bytes: number }> {
  const rows = await getSyncedWithLocal();
  return {
    count: rows.length,
    bytes: rows.reduce((sum, r) => sum + (r.byte_size || 0), 0),
  };
}

export async function deleteLocalCopyOnly(id: number, localUri: string): Promise<void> {
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {}
  await clearLocalUri(id);
}
