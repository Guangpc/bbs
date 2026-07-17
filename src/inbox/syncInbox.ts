import type { SQLiteDatabase } from "expo-sqlite";

import AppGroupInbox from "../../modules/app-group-inbox/src/AppGroupInboxModule";
import { TMP_MAX_AGE_MS } from "../constants";
import { consumeInboxItem } from "../consume/consumeInboxItem";
import { validateInboxItem } from "./schema";

export interface SyncSummary {
  processed: number;
  failed: number;
  errors: string[];
}

export async function syncInbox(db: SQLiteDatabase): Promise<SyncSummary> {
  const summary: SyncSummary = { processed: 0, failed: 0, errors: [] };

  try {
    await AppGroupInbox.cleanupStaleTmpFiles(TMP_MAX_AGE_MS);
  } catch {
    // App Group may be unavailable in Expo Go / simulator without entitlements.
  }

  let fileNames: string[] = [];
  try {
    fileNames = await AppGroupInbox.listInboxJsonFiles();
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
    return summary;
  }

  for (const fileName of fileNames) {
    try {
      const raw = await AppGroupInbox.readInboxFile(fileName);
      const parsed = validateInboxItem(JSON.parse(raw));
      await consumeInboxItem(parsed, db);
      await AppGroupInbox.deleteInboxFile(fileName);
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(
        `${fileName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}
