export type Platform =
  | "douyin"
  | "bilibili"
  | "xiaohongshu"
  | "kuaishou"
  | "x"
  | "unknown";

const URL_PATTERN = /https?:\/\/[^\s]+/gi;

const TRACKING_QUERY_KEYS = new Set([
  "spm_id_from",
  "vd_source",
  "share_source",
  "source",
  "xhsshare",
  "xsec_source",
  "xsec_token",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "previous_page",
  "share_channel",
  "share_medium",
]);

export function extractUrls(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map(trimTrailingJunk);
}

/**
 * Score a share-sheet URL. Higher = more likely the content the user meant to save.
 * Xiaohongshu often injects homepage / app-store / unrelated links alongside the real short link.
 */
export function scoreShareUrl(url: string): number {
  const parsed = parseUrl(ensureHttps(url));
  if (!parsed) {
    return 0;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  // Reject obvious non-content
  if (
    host.includes("apps.apple.com") ||
    host.includes("itunes.apple.com") ||
    host.includes("play.google.com") ||
    host.includes("app-store")
  ) {
    return 1;
  }

  // Xiaohongshu — short link & note pages win; bare site loses
  if (host === "xhslink.com" || host.endsWith(".xhslink.com")) {
    return 100;
  }
  if (host.includes("xiaohongshu.com")) {
    if (/\/(?:discovery\/item|explore|note)\/[0-9A-Za-z]+/.test(path)) {
      return 95;
    }
    // Profiles, search, home — not the note the user shared
    if (
      path === "/" ||
      path === "" ||
      path.startsWith("/user/") ||
      path.startsWith("/search") ||
      path.startsWith("/home")
    ) {
      return 5;
    }
    return 15;
  }

  // Douyin
  if (host === "v.douyin.com") {
    return 100;
  }
  if (host.includes("douyin.com") && /\/(?:video|share\/video)\/\d+/.test(path)) {
    return 95;
  }

  // Bilibili
  if (host === "b23.tv" || host.endsWith(".b23.tv")) {
    return 100;
  }
  if (host.includes("bilibili.com") && /\/video\/BV[0-9A-Za-z]+/.test(path)) {
    return 95;
  }

  // X
  if (
    (host === "x.com" || host.endsWith(".x.com") || host.includes("twitter.com")) &&
    /\/status\/\d+/.test(path)
  ) {
    return 100;
  }

  // Kuaishou
  if (host.includes("kuaishou.com") && /\/short-video\//.test(path)) {
    return 95;
  }

  return 40;
}

/**
 * Pick the best single URL from share payloads that may contain multiple links.
 * Boundary: never blindly use urls[0] when a higher-score content link exists.
 */
export function pickPrimaryUrl(
  urls: string[],
  rawText?: string | null,
): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const secured = ensureHttps(raw.trim());
    if (!secured || seen.has(secured)) {
      return;
    }
    seen.add(secured);
    candidates.push(secured);
  };

  for (const url of urls) {
    push(url);
  }
  if (rawText) {
    for (const url of extractUrls(rawText)) {
      push(url);
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const ranked = [...candidates].sort((a, b) => {
    const diff = scoreShareUrl(b) - scoreShareUrl(a);
    if (diff !== 0) {
      return diff;
    }
    // Stable: prefer earlier in original urls array (attachment order)
    return candidates.indexOf(a) - candidates.indexOf(b);
  });

  const best = ranked[0];
  // If best is still a weak homepage-like link, refuse rather than save wrong content
  if (scoreShareUrl(best) < 50) {
    // Still return best among weak — caller may fail later; prefer any https over nothing
    return best;
  }
  return best;
}

export function detectPlatform(url: string): Platform {
  const hostname = parseUrl(url)?.hostname.toLowerCase();

  if (!hostname) {
    return "unknown";
  }

  if (
    hostname === "v.douyin.com" ||
    hostname === "www.douyin.com" ||
    hostname.endsWith(".douyin.com")
  ) {
    return "douyin";
  }

  if (
    hostname === "b23.tv" ||
    hostname === "www.bilibili.com" ||
    hostname.endsWith(".bilibili.com")
  ) {
    return "bilibili";
  }

  if (
    hostname === "xhslink.com" ||
    hostname === "www.xhslink.com" ||
    hostname === "www.xiaohongshu.com" ||
    hostname.endsWith(".xiaohongshu.com")
  ) {
    return "xiaohongshu";
  }

  if (hostname === "www.kuaishou.com" || hostname.endsWith(".kuaishou.com")) {
    return "kuaishou";
  }

  if (
    hostname === "x.com" ||
    hostname === "twitter.com" ||
    hostname === "www.x.com" ||
    hostname === "www.twitter.com" ||
    hostname === "mobile.twitter.com" ||
    hostname.endsWith(".x.com") ||
    hostname.endsWith(".twitter.com")
  ) {
    return "x";
  }

  return "unknown";
}

export function normalizeUrl(url: string): string {
  const parsed = parseUrl(ensureHttps(url));

  if (!parsed) {
    return ensureHttps(url);
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol === "http:") {
    parsed.protocol = "https:";
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_QUERY_KEYS.has(key)) {
      parsed.searchParams.delete(key);
    }
  }

  if ([...parsed.searchParams.keys()].length === 0) {
    parsed.search = "";
  }

  return parsed.toString();
}

/** Upgrade http → https so iOS ATS does not block short-link fetches. */
export function ensureHttps(url: string): string {
  const trimmed = url.trim();
  if (/^http:\/\//i.test(trimmed)) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}

export function extractExternalId(platform: Platform, url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  if (platform === "bilibili") {
    const bv = pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1];
    if (bv) {
      return bv;
    }
    // b23.tv short links — same short path = same share target
    if (hostname === "b23.tv" || hostname.endsWith(".b23.tv")) {
      const short = pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/)?.[1];
      return short ? `s:${short}` : null;
    }
    return null;
  }

  if (platform === "xiaohongshu") {
    const note = pathname.match(/\/(?:discovery\/item|explore|note)\/([0-9A-Za-z]+)/)?.[1];
    if (note) {
      return note;
    }
    if (hostname === "xhslink.com" || hostname.endsWith(".xhslink.com")) {
      const short = pathname.match(/\/(?:m\/)?([A-Za-z0-9_-]+)\/?/)?.[1];
      return short ? `s:${short}` : null;
    }
    return null;
  }

  if (platform === "douyin") {
    const videoId =
      pathname.match(/\/video\/(\d+)/)?.[1] ??
      pathname.match(/\/share\/video\/(\d+)/)?.[1] ??
      null;
    if (videoId) {
      return videoId;
    }
    // v.douyin.com/AbCdEf/ short code
    if (hostname === "v.douyin.com" || hostname.endsWith(".douyin.com")) {
      const short = pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/)?.[1];
      if (short && !["video", "share", "user", "note"].includes(short)) {
        return `s:${short}`;
      }
    }
    return null;
  }

  if (platform === "kuaishou") {
    return pathname.match(/\/short-video\/([0-9A-Za-z]+)/)?.[1] ?? null;
  }

  if (platform === "x") {
    return pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
  }

  return null;
}

export function toCanonicalUrl(platform: Platform, normalizedUrl: string): string | null {
  const parsed = parseUrl(normalizedUrl);
  if (!parsed) {
    return null;
  }

  parsed.hash = "";

  if (platform === "douyin") {
    const id = extractExternalId("douyin", normalizedUrl);
    if (id && !id.startsWith("s:")) {
      return `https://www.douyin.com/video/${id}`;
    }
    // Keep short-link path as canonical so the same short URL dedupes
    parsed.search = "";
    return parsed.toString();
  }

  if (platform === "xiaohongshu") {
    const id = extractExternalId("xiaohongshu", normalizedUrl);
    if (id && !id.startsWith("s:")) {
      return `https://www.xiaohongshu.com/discovery/item/${id}`;
    }
    parsed.search = "";
    return parsed.toString();
  }

  if (platform === "x") {
    const id = extractExternalId("x", normalizedUrl);
    const user = parsed.pathname.match(/^\/([A-Za-z0-9_]+)\/status\//)?.[1];
    if (id && user) {
      return `https://x.com/${user}/status/${id}`;
    }
    parsed.search = "";
    parsed.hostname = parsed.hostname.replace(/^(www\.)?twitter\.com$/i, "x.com");
    return parsed.toString();
  }

  parsed.search = "";
  return parsed.toString();
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function trimTrailingJunk(url: string): string {
  return url.replace(/[),.;:!?\u3002\uFF0C\uFF01\uFF1F~]+$/u, "");
}
