import type { SQLiteDatabase } from "expo-sqlite";

import {
  findDeletedDuplicate,
  findLiveDuplicate,
  findVideoByIngestId,
  insertVideo,
  restoreDeletedVideo,
  updateLiveDuplicate,
} from "../db/repository";
import { validateInboxItem, type ShareInboxItemV1 } from "../inbox/schema";
import {
  detectPlatform,
  extractExternalId,
  extractUrls,
  normalizeUrl,
  pickPrimaryUrl,
  toCanonicalUrl,
} from "../parsers/share";
import { cleanShareText, mergeShareTextPreferringEnrichment, shareTextFromShareSheet } from "../parsers/titles";

export type ConsumeAction =
  | "inserted"
  | "already_processed"
  | "restored_deleted"
  | "updated_duplicate";

export interface ConsumeResult {
  action: ConsumeAction;
}

export async function consumeInboxItem(
  input: ShareInboxItemV1,
  db: SQLiteDatabase,
): Promise<ConsumeResult> {
  const item = validateInboxItem(input);
  const now = Date.now();
  const parsed = parseInboxItem(item);

  if (!parsed.originalUrl) {
    throw new Error("Inbox item has no URL");
  }

  await db.execAsync("BEGIN");

  try {
    if (await findVideoByIngestId(db, item.ingestId)) {
      await db.execAsync("COMMIT");
      return { action: "already_processed" };
    }

    const deletedMatch = await findDeletedDuplicate(
      db,
      parsed.platform,
      parsed.externalId,
      parsed.canonicalUrl,
    );

    if (deletedMatch) {
      const merged = mergeShareTextPreferringEnrichment(
        parsed.shareText,
        deletedMatch.share_text,
        !!deletedMatch.meta_enriched_at,
      );
      await restoreDeletedVideo(db, deletedMatch.id, merged, now);
      await db.execAsync("COMMIT");
      return { action: "restored_deleted" };
    }

    const updated = await updateLiveDuplicate(
      db,
      parsed.platform,
      parsed.externalId,
      parsed.canonicalUrl,
      parsed.shareText,
      now,
      parsed.normalizedUrl,
    );

    if (updated) {
      await db.execAsync("COMMIT");
      return { action: "updated_duplicate" };
    }

    await insertVideo(db, {
      id: `video-${item.ingestId}`,
      ingestId: item.ingestId,
      platform: parsed.platform,
      originalUrl: parsed.originalUrl,
      normalizedUrl: parsed.normalizedUrl,
      canonicalUrl: parsed.canonicalUrl,
      externalId: parsed.externalId,
      shareText: parsed.shareText,
      createdAt: now,
      updatedAt: now,
    });

    await db.execAsync("COMMIT");
    return { action: "inserted" };
  } catch (error) {
    await db.execAsync("ROLLBACK");
    throw error;
  }
}

/** Manual / paste path: ingest_id is NULL. */
export async function consumeManualShare(
  rawText: string,
  db: SQLiteDatabase,
): Promise<ConsumeResult> {
  const originalUrl = pickPrimaryUrl(extractUrls(rawText), rawText) ?? "";
  if (!originalUrl) {
    throw new Error("No HTTPS URL found");
  }

  const now = Date.now();
  const normalizedUrl = normalizeUrl(originalUrl);
  const platform = detectPlatform(normalizedUrl);
  const externalId = extractExternalId(platform, normalizedUrl);
  const canonicalUrl = toCanonicalUrl(platform, normalizedUrl);
  const shareText = cleanShareText(platform, rawText) ?? rawText;

  await db.execAsync("BEGIN");

  try {
    const deletedMatch = await findDeletedDuplicate(db, platform, externalId, canonicalUrl);
    if (deletedMatch) {
      const merged = mergeShareTextPreferringEnrichment(
        shareText,
        deletedMatch.share_text,
        !!deletedMatch.meta_enriched_at,
      );
      await restoreDeletedVideo(db, deletedMatch.id, merged, now);
      await db.execAsync("COMMIT");
      return { action: "restored_deleted" };
    }

    const updated = await updateLiveDuplicate(
      db,
      platform,
      externalId,
      canonicalUrl,
      shareText,
      now,
      normalizedUrl,
    );
    if (updated) {
      await db.execAsync("COMMIT");
      return { action: "updated_duplicate" };
    }

    // Extra guard: live duplicate by any key
    if (await findLiveDuplicate(db, platform, externalId, canonicalUrl, normalizedUrl)) {
      await updateLiveDuplicate(
        db,
        platform,
        externalId,
        canonicalUrl,
        shareText,
        now,
        normalizedUrl,
      );
      await db.execAsync("COMMIT");
      return { action: "updated_duplicate" };
    }

    await insertVideo(db, {
      id: `manual-${now}`,
      ingestId: null,
      platform,
      originalUrl,
      normalizedUrl,
      canonicalUrl,
      externalId,
      shareText,
      createdAt: now,
      updatedAt: now,
    });

    await db.execAsync("COMMIT");
    return { action: "inserted" };
  } catch (error) {
    await db.execAsync("ROLLBACK");
    throw error;
  }
}

function parseInboxItem(item: ShareInboxItemV1) {
  const originalUrl = pickPrimaryUrl(item.urls, item.rawText) ?? "";
  const normalizedUrl = normalizeUrl(originalUrl);
  const platform = detectPlatform(normalizedUrl);
  const externalId = extractExternalId(platform, normalizedUrl);
  const canonicalUrl = toCanonicalUrl(platform, normalizedUrl);
  const cleaned = cleanShareText(platform, item.rawText);
  // Network-enrich platforms: sheet text (esp. video chrome) is untrusted; URL only.
  const shareText = shareTextFromShareSheet(platform, cleaned, item.rawText);

  return {
    platform,
    originalUrl,
    normalizedUrl,
    canonicalUrl,
    externalId,
    shareText,
  };
}
