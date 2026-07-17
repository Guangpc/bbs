import type { SQLiteDatabase } from "expo-sqlite";

import {
  findLiveDuplicate,
  mergeDuplicatesByExternalId,
  softDeleteVideo,
  updateVideoEnrichment,
} from "../db/repository";
import { listLiveVideos, type VideoRow } from "../db/schema";
import { extractExternalId, ensureHttps, normalizeUrl, toCanonicalUrl } from "../parsers/share";
import { usesNetworkEnrichment } from "../parsers/titles";
import { fetchXiaohongshuPage } from "./fetchXiaohongshu";
import { fetchXStatus } from "./fetchX";

export function hasUsefulShareText(video: VideoRow): boolean {
  const text = video.share_text?.trim();
  if (!text) {
    return false;
  }
  if (text === video.original_url || text === video.normalized_url || text === video.canonical_url) {
    return false;
  }
  const onlyUrl = text.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
  if (onlyUrl && onlyUrl === text) {
    return false;
  }
  // @handle alone is not useful body text
  if (/^@[A-Za-z0-9_]+$/u.test(text)) {
    return false;
  }
  return true;
}

/**
 * Share sheet often attaches unrelated chrome while the URL is correct.
 * Share rows (ingest_id) always attempt network enrich; paste with useful text may skip.
 * Once network-filled (meta_enriched_at), skip unless explicit refetch.
 */
export function needsNetworkEnrichment(video: VideoRow): boolean {
  if (!usesNetworkEnrichment(video.platform)) {
    return false;
  }
  if (video.meta_enriched_at) {
    return false;
  }
  // Share Extension rows: always enrich (sheet text is untrusted).
  if (video.ingest_id) {
    return true;
  }
  return !hasUsefulShareText(video);
}

export function needsXiaohongshuEnrichment(video: VideoRow): boolean {
  return video.platform === "xiaohongshu" && needsNetworkEnrichment(video);
}

export function needsXEnrichment(video: VideoRow): boolean {
  return video.platform === "x" && needsNetworkEnrichment(video);
}

export function needsMetadataEnrichment(video: VideoRow): boolean {
  return needsNetworkEnrichment(video);
}

export interface EnrichSummary {
  attempted: number;
  updated: number;
  failed: number;
  errors: string[];
}

function emptySummary(): EnrichSummary {
  return { attempted: 0, updated: 0, failed: 0, errors: [] };
}

function mergeSummaries(a: EnrichSummary, b: EnrichSummary): EnrichSummary {
  return {
    attempted: a.attempted + b.attempted,
    updated: a.updated + b.updated,
    failed: a.failed + b.failed,
    errors: [...a.errors, ...b.errors],
  };
}

/** Enrich Xiaohongshu + X posts that only have a link / @handle. */
export async function enrichVideosMetadata(
  db: SQLiteDatabase,
  options?: {
    videoIds?: string[];
    limit?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<EnrichSummary> {
  const xhs = await enrichXiaohongshuVideos(db, options);
  const x = await enrichXVideos(db, options);
  return mergeSummaries(xhs, x);
}

export async function enrichXiaohongshuVideos(
  db: SQLiteDatabase,
  options?: {
    videoIds?: string[];
    limit?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<EnrichSummary> {
  const summary = emptySummary();
  const all = await listLiveVideos(db);
  const idFilter = options?.videoIds ? new Set(options.videoIds) : null;
  const candidates = all.filter((video) => {
    if (idFilter && !idFilter.has(video.id)) {
      return false;
    }
    // Explicit refetch (重新获取) bypasses the “already enriched” skip.
    if (idFilter) {
      return video.platform === "xiaohongshu";
    }
    return needsXiaohongshuEnrichment(video) || shouldRefreshXiaohongshuIds(video);
  });

  const limit = options?.limit ?? 8;
  const batch = candidates.slice(0, limit);

  for (const video of batch) {
    summary.attempted += 1;
    try {
      const sourceUrl = ensureHttps(
        video.original_url || video.normalized_url || video.canonical_url || "",
      );
      if (!sourceUrl) {
        throw new Error("缺少可请求的链接");
      }

      const result = await fetchXiaohongshuPage(sourceUrl, options?.fetchImpl ?? fetch);
      const normalized = normalizeUrl(result.finalUrl);
      const externalId =
        result.meta.noteId ??
        extractExternalId("xiaohongshu", normalized) ??
        extractExternalId("xiaohongshu", result.finalUrl);
      const canonical =
        toCanonicalUrl("xiaohongshu", normalized) ??
        (externalId && !externalId.startsWith("s:")
          ? `https://www.xiaohongshu.com/discovery/item/${externalId}`
          : null);

      if (externalId && !externalId.startsWith("s:")) {
        const existing = await findLiveDuplicate(db, "xiaohongshu", externalId, canonical, null);
        if (existing && existing.id !== video.id) {
          // Network text wins — share-sheet text is often wrong for videos.
          await updateVideoEnrichment(db, existing.id, {
            shareText: result.shareText,
            canonicalUrl: canonical ?? existing.canonical_url,
            externalId,
            normalizedUrl: normalized || existing.normalized_url,
            noteType: result.meta.noteType,
          });
          await softDeleteVideo(db, video.id);
          await mergeDuplicatesByExternalId(db, "xiaohongshu", externalId, existing.id);
          summary.updated += 1;
          continue;
        }
      }

      await updateVideoEnrichment(db, video.id, {
        shareText: result.shareText,
        canonicalUrl: canonical ?? video.canonical_url,
        externalId: externalId ?? video.external_id,
        normalizedUrl: normalized || video.normalized_url,
        originalUrl: ensureHttps(video.original_url),
        noteType: result.meta.noteType,
      });

      if (externalId && !externalId.startsWith("s:")) {
        await mergeDuplicatesByExternalId(db, "xiaohongshu", externalId, video.id);
      }

      summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(
        `${video.id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}

export async function enrichXVideos(
  db: SQLiteDatabase,
  options?: {
    videoIds?: string[];
    limit?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<EnrichSummary> {
  const summary = emptySummary();
  const all = await listLiveVideos(db);
  const idFilter = options?.videoIds ? new Set(options.videoIds) : null;
  const candidates = all.filter((video) => {
    if (idFilter && !idFilter.has(video.id)) {
      return false;
    }
    if (idFilter) {
      return video.platform === "x";
    }
    return needsXEnrichment(video);
  });

  const limit = options?.limit ?? 8;
  const batch = candidates.slice(0, limit);

  for (const video of batch) {
    summary.attempted += 1;
    try {
      const sourceUrl = ensureHttps(
        video.canonical_url ?? video.normalized_url ?? video.original_url ?? "",
      );
      if (!sourceUrl) {
        throw new Error("缺少可请求的链接");
      }

      const result = await fetchXStatus(sourceUrl, options?.fetchImpl ?? fetch);
      const normalized = normalizeUrl(result.finalUrl);
      const externalId =
        result.meta.statusId ??
        extractExternalId("x", normalized) ??
        extractExternalId("x", result.finalUrl);
      const canonical = toCanonicalUrl("x", normalized) ?? result.finalUrl;

      if (externalId) {
        const existing = await findLiveDuplicate(db, "x", externalId, canonical, null);
        if (existing && existing.id !== video.id) {
          await updateVideoEnrichment(db, existing.id, {
            shareText: result.shareText,
            canonicalUrl: canonical,
            externalId,
            normalizedUrl: normalized,
          });
          await softDeleteVideo(db, video.id);
          await mergeDuplicatesByExternalId(db, "x", externalId, existing.id);
          summary.updated += 1;
          continue;
        }
      }

      await updateVideoEnrichment(db, video.id, {
        shareText: result.shareText,
        canonicalUrl: canonical,
        externalId: externalId ?? video.external_id,
        normalizedUrl: normalized,
        originalUrl: ensureHttps(video.original_url),
      });

      if (externalId) {
        await mergeDuplicatesByExternalId(db, "x", externalId, video.id);
      }

      summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(
        `${video.id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}

function shouldRefreshXiaohongshuIds(video: VideoRow): boolean {
  return (
    video.platform === "xiaohongshu" &&
    !!video.external_id?.startsWith("s:") &&
    !video.meta_enriched_at
  );
}
