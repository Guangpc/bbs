import { ensureHttps } from "../parsers/share";
import {
  extractInitialStateRaw,
  parseInitialStateObject,
} from "../metadata/xiaohongshuHtml";
import { extractOgImageUrl } from "./resolveCoverUrl";

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type SummaryMediaBasis = "video" | "cover" | "text";

export interface ResolvedSummarizeMedia {
  videoUrl: string | null;
  coverUrl: string | null;
  basis: SummaryMediaBasis;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function asHttpsMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = decodeHtmlEntities(value).trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  const url = ensureHttps(trimmed);
  // Reject obvious page URLs posing as media.
  if (/\/explore\/|\/discovery\/item\/|\/status\//i.test(url) && !/\.(mp4|m3u8|mov)(\?|$)/i.test(url)) {
    return null;
  }
  return url;
}

/** Prefer real playable media URLs over thumbnails. */
export function looksLikeVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(mp4|m3u8|mov|webm)(\?|$)/i.test(lower)) {
    return true;
  }
  if (/video\.twimg\.com|twimg\.com\/ext_tw_video|sns-video|xhscdn\.com.*video/i.test(lower)) {
    return true;
  }
  return false;
}

function collectStringUrls(value: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 40) {
    return;
  }
  if (typeof value === "string") {
    const url = asHttpsMediaUrl(value);
    if (url) {
      out.push(url);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringUrls(item, out, depth + 1);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectStringUrls(child, out, depth + 1);
    }
  }
}

/** Pick the best video-like URL from a nested media object. */
export function pickVideoUrlFromObject(root: unknown): string | null {
  const urls: string[] = [];
  collectStringUrls(root, urls);
  const videoLike = urls.filter(looksLikeVideoUrl);
  if (videoLike.length > 0) {
    // Prefer mp4 over m3u8 when both exist.
    const mp4 = videoLike.find((u) => /\.mp4(\?|$)/i.test(u));
    return mp4 ?? videoLike[0] ?? null;
  }
  return null;
}

/** og:video / twitter player stream from HTML. */
export function extractOgVideoUrl(html: string): string | null {
  const patterns = [
    /property=["']og:video(?::(?:url|secure_url))?["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']og:video(?::(?:url|secure_url))?["']/i,
    /name=["']twitter:player:stream["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']twitter:player:stream["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re)?.[1];
    const url = match ? asHttpsMediaUrl(match) : null;
    if (url && looksLikeVideoUrl(url)) {
      return url;
    }
  }
  return null;
}

export function videoFromFxTwitterJson(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const root = data as {
    tweet?: {
      media?: {
        videos?: Array<{ url?: string; variants?: Array<{ url?: string }> }>;
      };
    };
  };
  const videos = root.tweet?.media?.videos ?? [];
  for (const video of videos) {
    const direct = asHttpsMediaUrl(video.url);
    if (direct && looksLikeVideoUrl(direct)) {
      return direct;
    }
    const variant = video.variants?.map((v) => asHttpsMediaUrl(v.url)).find((u) => u && looksLikeVideoUrl(u));
    if (variant) {
      return variant;
    }
  }
  return pickVideoUrlFromObject(root.tweet?.media?.videos ?? null);
}

function noteIdFromUrl(url: string): string | null {
  try {
    return (
      new URL(url).pathname.match(/\/(?:discovery\/item|explore|note)\/([0-9A-Za-z]+)/)?.[1] ??
      null
    );
  } catch {
    return null;
  }
}

function statusIdFromXUrl(url: string): string | null {
  try {
    return new URL(url).pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort: find the current note's video payload inside XHS __INITIAL_STATE__.
 */
export function extractXiaohongshuVideoUrlFromHtml(
  html: string,
  pageUrl: string,
): string | null {
  const fromOg = extractOgVideoUrl(html);
  if (fromOg) {
    return fromOg;
  }

  const raw = extractInitialStateRaw(html);
  if (!raw) {
    return null;
  }
  // parseInitialStateObject expects full HTML or we reuse its tolerant parse via a fake wrapper
  const state = parseInitialStateObject(`<script>window.__INITIAL_STATE__=${raw};</script>`);
  if (!state) {
    return null;
  }

  const preferId = noteIdFromUrl(pageUrl);
  if (!preferId) {
    return null;
  }
  const note = findNoteRecord(state, preferId);
  if (!note) {
    return null;
  }
  return pickVideoUrlFromObject(note.video ?? note);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function findNoteRecord(
  state: unknown,
  preferNoteId: string | null,
): Record<string, unknown> | null {
  const root = asRecord(state);
  const note = asRecord(root?.note);
  const map = asRecord(note?.noteDetailMap);
  if (!map || !preferNoteId) {
    return null;
  }
  const entry = asRecord(map[preferNoteId]);
  const inner = asRecord(entry?.note);
  return inner;
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const response = await fetchImpl(ensureHttps(url), {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json",
      "User-Agent": DEFAULT_UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) {
    return null;
  }
  return response.text();
}

async function resolveFromX(
  pageUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ videoUrl: string | null; coverUrl: string | null }> {
  const statusId = statusIdFromXUrl(pageUrl);
  if (statusId) {
    try {
      const response = await fetchImpl(`https://api.fxtwitter.com/status/${statusId}`, {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": DEFAULT_UA },
      });
      if (response.ok) {
        const data = await response.json();
        const videoUrl = videoFromFxTwitterJson(data);
        const coverUrl = (() => {
          const media = (data as { tweet?: { media?: unknown } })?.tweet?.media;
          const urls: string[] = [];
          collectStringUrls(media, urls);
          const thumb = urls.find(
            (u) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u) || /pbs\.twimg\.com\/media/i.test(u),
          );
          return thumb ?? null;
        })();
        if (videoUrl || coverUrl) {
          return { videoUrl, coverUrl };
        }
      }
    } catch {
      // fall through to HTML
    }
  }

  const html = await fetchText(pageUrl, fetchImpl);
  if (!html) {
    return { videoUrl: null, coverUrl: null };
  }
  return {
    videoUrl: extractOgVideoUrl(html),
    coverUrl: extractOgImageUrl(html),
  };
}

async function resolveFromHtmlPage(
  pageUrl: string,
  platform: string,
  fetchImpl: typeof fetch,
): Promise<{ videoUrl: string | null; coverUrl: string | null }> {
  const html = await fetchText(pageUrl, fetchImpl);
  if (!html) {
    return { videoUrl: null, coverUrl: null };
  }
  const coverUrl = extractOgImageUrl(html);
  let videoUrl = extractOgVideoUrl(html);
  if (!videoUrl && platform === "xiaohongshu") {
    videoUrl = extractXiaohongshuVideoUrlFromHtml(html, pageUrl);
  }
  return { videoUrl, coverUrl };
}

/**
 * Resolve best-effort public media for summarize.
 * Priority for callers: videoUrl → coverUrl → text-only.
 * Never throws.
 */
export async function resolveSummarizeMedia(options: {
  platform: string;
  pageUrl: string | null;
  cachedCoverUrl?: string | null;
  cachedMediaUrl?: string | null;
  /** When false, skip video resolution (text/image only models). */
  wantVideo?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedSummarizeMedia> {
  const wantVideo = options.wantVideo !== false;
  const cachedCover = options.cachedCoverUrl?.trim()
    ? ensureHttps(options.cachedCoverUrl.trim())
    : null;
  const cachedMedia =
    wantVideo && options.cachedMediaUrl?.trim() && looksLikeVideoUrl(options.cachedMediaUrl.trim())
      ? ensureHttps(options.cachedMediaUrl.trim())
      : null;

  const pageUrl = options.pageUrl?.trim();
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
    if (cachedMedia) {
      return { videoUrl: cachedMedia, coverUrl: cachedCover, basis: "video" };
    }
    if (cachedCover) {
      return { videoUrl: null, coverUrl: cachedCover, basis: "cover" };
    }
    return { videoUrl: null, coverUrl: null, basis: "text" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const secure = ensureHttps(pageUrl);

  let videoUrl: string | null = null;
  let coverUrl: string | null = cachedCover;

  try {
    const resolved =
      options.platform === "x"
        ? await resolveFromX(secure, fetchImpl)
        : await resolveFromHtmlPage(secure, options.platform, fetchImpl);
    if (wantVideo) {
      videoUrl = resolved.videoUrl;
    }
    coverUrl = resolved.coverUrl ?? coverUrl;
  } catch {
    // keep cached
  }

  if (wantVideo && !videoUrl && cachedMedia) {
    videoUrl = cachedMedia;
  }

  if (wantVideo && videoUrl) {
    return { videoUrl, coverUrl, basis: "video" };
  }
  if (coverUrl) {
    return { videoUrl: null, coverUrl, basis: "cover" };
  }
  return { videoUrl: null, coverUrl: null, basis: "text" };
}

export function summaryBasisLabel(basis: SummaryMediaBasis): string {
  switch (basis) {
    case "video":
      return "本次依据：视频直链";
    case "cover":
      return "本次依据：封面图 + 文字";
    default:
      return "本次依据：仅文字/标题";
  }
}
