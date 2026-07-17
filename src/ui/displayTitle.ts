import type { VideoRow } from "../db/schema";
import { cleanShareText, titleFromUrl } from "../parsers/titles";

const TITLE_MAX_CHARS = 36;

function isUrlOnly(text: string, video: VideoRow): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (
    trimmed === video.original_url ||
    trimmed === video.normalized_url ||
    trimmed === video.canonical_url
  ) {
    return true;
  }
  const onlyUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
  return !!(onlyUrl && onlyUrl === trimmed);
}

function truncateTitle(title: string, max = TITLE_MAX_CHARS): string {
  const chars = [...title];
  if (chars.length <= max) {
    return title;
  }
  return `${chars.slice(0, max).join("")}…`;
}

function primaryUrl(video: VideoRow): string | null {
  return video.canonical_url ?? video.normalized_url ?? video.original_url ?? null;
}

/**
 * List card title: platform-aware cleaned text, length-capped.
 * Douyin: keep文案 before URL, never leave orphan「复制」.
 * X: use tweet text if any; else @username from link.
 */
export function displayTitle(video: VideoRow): string | null {
  const text = video.share_text?.trim() ?? "";
  const url = primaryUrl(video);

  if (text && !isUrlOnly(text, video)) {
    const cleaned = cleanShareText(video.platform, text);
    if (cleaned) {
      return truncateTitle(cleaned);
    }
  }

  // Link-only share (common for X) or corrupted「复制」 leftovers
  const fromUrl = titleFromUrl(video.platform, url);
  return fromUrl ? truncateTitle(fromUrl) : null;
}
