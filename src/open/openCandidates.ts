import type { VideoRow } from "../db/schema";
import { ensureHttps, extractExternalId } from "../parsers/share";

/**
 * Build open targets for a saved item.
 * Douyin / Bilibili https short links are Universal Links → native app.
 * Xiaohongshu https often lands in Safari; use official schemes instead:
 *   图文: xhsdiscover://item/<id>
 *   视频: xhsdiscover://video_feed/<id>
 * @see https://pages.xiaohongshu.com/activity/deeplink
 */
export function buildOpenUrlCandidates(video: VideoRow): string[] {
  const https = ensureHttps(
    video.original_url || video.canonical_url || video.normalized_url || "",
  );
  const candidates: string[] = [];

  if (video.platform === "xiaohongshu") {
    const noteId = resolveXiaohongshuNoteId(video);
    const kind = (video.note_type ?? "").toLowerCase();
    const isVideo = kind === "video" || kind === "vedio";

    if (noteId) {
      if (isVideo) {
        candidates.push(`xhsdiscover://video_feed/${noteId}`);
        candidates.push(`xhsdiscover://item/${noteId}?type=vedio`);
      } else if (kind === "normal" || kind === "multi") {
        candidates.push(`xhsdiscover://item/${noteId}`);
      } else {
        // Unknown type: NEVER prefer bare item first — that opens 视频 as 图文.
        candidates.push(`xhsdiscover://video_feed/${noteId}`);
        candidates.push(`xhsdiscover://item/${noteId}?type=vedio`);
        candidates.push(`xhsdiscover://item/${noteId}`);
      }
    }
  }

  if (video.platform === "douyin") {
    const id =
      video.external_id && !video.external_id.startsWith("s:")
        ? video.external_id
        : extractExternalId("douyin", https);
    if (id && !id.startsWith("s:")) {
      candidates.push(`snssdk1128://aweme/detail/${id}`);
    }
  }

  if (video.platform === "bilibili") {
    const bv =
      video.external_id && !video.external_id.startsWith("s:")
        ? video.external_id
        : extractExternalId("bilibili", https);
    if (bv && /^BV/i.test(bv)) {
      candidates.push(`bilibili://video/${bv}`);
    }
  }

  if (https) {
    candidates.push(https);
  }

  const seen = new Set<string>();
  return candidates.filter((u) => {
    if (!u || seen.has(u)) {
      return false;
    }
    seen.add(u);
    return true;
  });
}

function resolveXiaohongshuNoteId(video: VideoRow): string | null {
  if (video.external_id && !video.external_id.startsWith("s:")) {
    return video.external_id;
  }
  for (const url of [video.canonical_url, video.normalized_url, video.original_url]) {
    if (!url) {
      continue;
    }
    const id = extractExternalId("xiaohongshu", url);
    if (id && !id.startsWith("s:")) {
      return id;
    }
  }
  return null;
}
