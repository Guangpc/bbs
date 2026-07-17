import type { SQLiteDatabase } from "expo-sqlite";

import type { Platform } from "../parsers/share";
import { mergeShareTextPreferringEnrichment, preferShareText } from "../parsers/titles";
import type { VideoRow } from "./schema";

export interface NewVideoRecord {
  id: string;
  ingestId: string | null;
  platform: Platform;
  originalUrl: string;
  normalizedUrl: string;
  canonicalUrl: string | null;
  externalId: string | null;
  shareText: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function findVideoByIngestId(
  db: SQLiteDatabase,
  ingestId: string,
): Promise<VideoRow | null> {
  return (
    (await db.getFirstAsync<VideoRow>("SELECT * FROM videos WHERE ingest_id = ?", [
      ingestId,
    ])) ?? null
  );
}

export async function findDeletedDuplicate(
  db: SQLiteDatabase,
  platform: Platform,
  externalId: string | null,
  canonicalUrl: string | null,
): Promise<VideoRow | null> {
  if (externalId) {
    const match = await db.getFirstAsync<VideoRow>(
      "SELECT * FROM videos WHERE deleted_at IS NOT NULL AND platform = ? AND external_id = ? LIMIT 1",
      [platform, externalId],
    );
    if (match) {
      return match;
    }
  }

  if (canonicalUrl) {
    return (
      (await db.getFirstAsync<VideoRow>(
        "SELECT * FROM videos WHERE deleted_at IS NOT NULL AND canonical_url = ? LIMIT 1",
        [canonicalUrl],
      )) ?? null
    );
  }

  return null;
}

export async function restoreDeletedVideo(
  db: SQLiteDatabase,
  id: string,
  shareText: string | null,
  updatedAt: number,
): Promise<void> {
  await db.runAsync(
    "UPDATE videos SET deleted_at = NULL, status = 'unread', share_text = ?, updated_at = ? WHERE id = ?",
    [shareText, updatedAt, id],
  );
}

export async function insertVideo(db: SQLiteDatabase, record: NewVideoRecord): Promise<void> {
  await db.runAsync(
    `INSERT INTO videos (
      id, ingest_id, platform, original_url, normalized_url, canonical_url, external_id, share_text,
      status, is_pinned, open_count, last_opened_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unread', 0, 0, NULL, ?, ?, NULL)`,
    [
      record.id,
      record.ingestId,
      record.platform,
      record.originalUrl,
      record.normalizedUrl,
      record.canonicalUrl,
      record.externalId,
      record.shareText,
      record.createdAt,
      record.updatedAt,
    ],
  );
}

export async function softDeleteVideo(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync("UPDATE videos SET deleted_at = ?, updated_at = ? WHERE id = ?", [
    Date.now(),
    Date.now(),
    id,
  ]);
}

export async function setVideoPinned(
  db: SQLiteDatabase,
  id: string,
  pinned: boolean,
): Promise<void> {
  await db.runAsync("UPDATE videos SET is_pinned = ?, updated_at = ? WHERE id = ?", [
    pinned ? 1 : 0,
    Date.now(),
    id,
  ]);
}

/** Mark watched, bump open_count, append watch_history. */
export async function recordVideoOpen(db: SQLiteDatabase, videoId: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE videos
     SET status = 'watched',
         open_count = open_count + 1,
         last_opened_at = ?,
         watched_at = COALESCE(watched_at, ?),
         updated_at = ?
     WHERE id = ?`,
    [now, now, now, videoId],
  );
  await db.runAsync(
    "INSERT INTO watch_history (id, video_id, opened_at) VALUES (?, ?, ?)",
    [`wh-${videoId}-${now}`, videoId, now],
  );
}

export async function updateVideoEnrichment(
  db: SQLiteDatabase,
  id: string,
  fields: {
    shareText: string;
    canonicalUrl?: string | null;
    externalId?: string | null;
    normalizedUrl?: string | null;
    originalUrl?: string | null;
    noteType?: string | null;
  },
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE videos
     SET share_text = ?,
         canonical_url = COALESCE(?, canonical_url),
         external_id = COALESCE(?, external_id),
         normalized_url = COALESCE(?, normalized_url),
         original_url = COALESCE(?, original_url),
         note_type = COALESCE(?, note_type),
         meta_enriched_at = ?,
         updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      fields.shareText,
      fields.canonicalUrl ?? null,
      fields.externalId ?? null,
      fields.normalizedUrl ?? null,
      fields.originalUrl ?? null,
      fields.noteType ?? null,
      now,
      now,
      id,
    ],
  );
}

export async function updateVideoComment(
  db: SQLiteDatabase,
  id: string,
  comment: string | null,
): Promise<void> {
  const trimmed = comment?.trim() || null;
  await db.runAsync(
    `UPDATE videos
     SET comment = ?,
         updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [trimmed, Date.now(), id],
  );
}

export async function updateVideoCoverUrl(
  db: SQLiteDatabase,
  id: string,
  coverUrl: string | null,
): Promise<void> {
  const trimmed = coverUrl?.trim() || null;
  await db.runAsync(
    `UPDATE videos
     SET cover_url = ?,
         updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [trimmed, Date.now(), id],
  );
}

export async function updateVideoMediaCache(
  db: SQLiteDatabase,
  id: string,
  fields: {
    coverUrl?: string | null;
    mediaUrl?: string | null;
  },
): Promise<void> {
  const now = Date.now();
  if (fields.coverUrl !== undefined) {
    await db.runAsync(
      `UPDATE videos
       SET cover_url = ?,
           updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [fields.coverUrl?.trim() || null, now, id],
    );
  }
  if (fields.mediaUrl !== undefined) {
    await db.runAsync(
      `UPDATE videos
       SET media_url = ?,
           updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [fields.mediaUrl?.trim() || null, now, id],
    );
  }
}

export async function updateVideoAiSummary(
  db: SQLiteDatabase,
  id: string,
  summary: string,
  basis?: string | null,
): Promise<void> {
  const trimmed = summary.trim();
  const now = Date.now();
  await db.runAsync(
    `UPDATE videos
     SET ai_summary = ?,
         ai_summarized_at = ?,
         ai_summary_basis = ?,
         updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [trimmed || null, trimmed ? now : null, basis ?? null, now, id],
  );
}

export async function findLiveDuplicate(
  db: SQLiteDatabase,
  platform: Platform,
  externalId: string | null,
  canonicalUrl: string | null,
  normalizedUrl?: string | null,
): Promise<VideoRow | null> {
  if (externalId) {
    const byExternal = await db.getFirstAsync<VideoRow>(
      "SELECT * FROM videos WHERE deleted_at IS NULL AND platform = ? AND external_id = ? LIMIT 1",
      [platform, externalId],
    );
    if (byExternal) {
      return byExternal;
    }
  }

  if (canonicalUrl) {
    const byCanonical = await db.getFirstAsync<VideoRow>(
      "SELECT * FROM videos WHERE deleted_at IS NULL AND canonical_url = ? LIMIT 1",
      [canonicalUrl],
    );
    if (byCanonical) {
      return byCanonical;
    }
  }

  if (normalizedUrl) {
    const byNormalized = await db.getFirstAsync<VideoRow>(
      "SELECT * FROM videos WHERE deleted_at IS NULL AND normalized_url = ? LIMIT 1",
      [normalizedUrl],
    );
    if (byNormalized) {
      return byNormalized;
    }
  }

  return null;
}

export async function updateLiveDuplicate(
  db: SQLiteDatabase,
  platform: Platform,
  externalId: string | null,
  canonicalUrl: string | null,
  shareText: string | null,
  updatedAt: number,
  normalizedUrl?: string | null,
): Promise<boolean> {
  const existing = await findLiveDuplicate(
    db,
    platform,
    externalId,
    canonicalUrl,
    normalizedUrl,
  );
  if (!existing) {
    return false;
  }

  const mergedText = mergeShareTextPreferringEnrichment(
    shareText,
    existing.share_text,
    !!existing.meta_enriched_at,
  );
  await db.runAsync(
    `UPDATE videos
     SET share_text = ?,
         external_id = COALESCE(?, external_id),
         canonical_url = COALESCE(?, canonical_url),
         normalized_url = COALESCE(?, normalized_url),
         updated_at = ?
     WHERE id = ?`,
    [
      mergedText,
      externalId,
      canonicalUrl,
      normalizedUrl ?? null,
      updatedAt,
      existing.id,
    ],
  );
  return true;
}

/** Soft-delete other live rows that share the same platform + external_id, keep `keepId`. */
export async function mergeDuplicatesByExternalId(
  db: SQLiteDatabase,
  platform: Platform,
  externalId: string,
  keepId: string,
): Promise<number> {
  if (!externalId || externalId.startsWith("s:")) {
    return 0;
  }

  const others = await db.getAllAsync<VideoRow>(
    `SELECT * FROM videos
     WHERE deleted_at IS NULL
       AND platform = ?
       AND external_id = ?
       AND id != ?`,
    [platform, externalId, keepId],
  );

  if (others.length === 0) {
    return 0;
  }

  const keep = await db.getFirstAsync<VideoRow>("SELECT * FROM videos WHERE id = ?", [
    keepId,
  ]);
  const pool = keep ? [keep, ...others] : others;
  const enriched = pool.filter((row) => row.meta_enriched_at && row.share_text?.trim());
  let bestText: string | null = null;
  let bestEnrichedAt: number | null = keep?.meta_enriched_at ?? null;

  if (enriched.length > 0) {
    for (const row of enriched) {
      bestText = preferShareText(row.share_text, bestText);
      if (row.meta_enriched_at && (!bestEnrichedAt || row.meta_enriched_at > bestEnrichedAt)) {
        bestEnrichedAt = row.meta_enriched_at;
      }
    }
  } else {
    bestText = keep?.share_text ?? null;
    for (const row of others) {
      bestText = preferShareText(row.share_text, bestText);
    }
  }

  const now = Date.now();
  if (keep && (bestText !== keep.share_text || (bestEnrichedAt && !keep.meta_enriched_at))) {
    await db.runAsync(
      "UPDATE videos SET share_text = ?, meta_enriched_at = COALESCE(?, meta_enriched_at), updated_at = ? WHERE id = ?",
      [bestText, bestEnrichedAt, now, keepId],
    );
  }

  for (const row of others) {
    await db.runAsync(
      "UPDATE videos SET deleted_at = ?, updated_at = ? WHERE id = ?",
      [now, now, row.id],
    );
  }

  return others.length;
}
