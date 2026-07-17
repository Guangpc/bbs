import type { Platform } from "./share";

/** Standalone crumbs left after bad boilerplate stripping — treat as empty. */
const WEAK_TOKENS = new Set([
  "复制",
  "链接",
  "打开",
  "抖音",
  "douyin",
  "dou音",
  "视频",
  "分享",
  "点击",
]);

/**
 * Douyin share blobs usually look like:
 *   `文案… https://v.douyin.com/xxx/ 复制此链接，打开Dou音搜索，直接观看视频！`
 * Prefer text BEFORE the first URL; only then scrub trailing boilerplate.
 */
function textBeforeFirstUrl(raw: string): string {
  const match = raw.match(/https?:\/\/[^\s]+/i);
  if (!match || match.index === undefined) {
    return raw.trim();
  }
  return raw.slice(0, match.index).trim();
}

function textAfterFirstUrl(raw: string): string {
  const match = raw.match(/https?:\/\/[^\s]+/i);
  if (!match || match.index === undefined) {
    return "";
  }
  return raw.slice(match.index + match[0].length).trim();
}

function stripDouyinBoilerplate(text: string): string {
  const bracket = [...text.matchAll(/【\s*([^】]+?)\s*】/g)]
    .map((m) => m[1].trim())
    .find((s) => s && s !== "抖音" && s.length > 0);

  let t = text
    .replace(/^\d+\.?\d*\s+/u, "")
    .replace(/^[@＠]\s*/u, "")
    .replace(/^【\s*抖音\s*】\s*/u, "")
    // Prefix wrappers — do not use open-ended "打开抖音.*" (it ate the real title)
    .replace(/^复制打开抖音[，,.\s]*/u, "")
    .replace(/^打开抖音[，,.\s]*/u, "")
    .replace(/^看看?/u, "")
    .replace(/的精彩内容[!！。.]*$/u, "")
    .replace(/的作品[!！。.]*$/u, "")
    // Trailing share tails only
    .replace(/复制此链接[，,].*$/u, "")
    .replace(/复制链接[，,].*$/u, "")
    .replace(/长按复制.*$/u, "")
    .replace(/请使用抖音.*$/u, "")
    .replace(/(?:Dou音|抖音)搜索.*$/u, "")
    .replace(/直接观看视频.*$/u, "")
    .replace(/点击链接.*$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    // Unwrap leftover 【title】
    .replace(/^【\s*([^】]+?)\s*】$/u, "$1")
    .trim();

  if ((!t || isBoilerplateOnly(t)) && bracket) {
    return bracket;
  }
  return t;
}

function stripGenericBoilerplate(text: string): string {
  return text
    .replace(/(?:点击链接直接打开|打开看看|分享自\s*(?:抖音|小红书|快手|哔哩哔哩|B站)).*$/giu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoilerplateOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (WEAK_TOKENS.has(t.toLowerCase())) return true;
  // "复制打开" / "复制链接" etc.
  if (/^(复制|打开|链接|分享)+$/u.test(t)) return true;
  return false;
}

/**
 * Clean raw share clipboard / share-sheet text into a displayable title body.
 */
export function cleanShareText(
  platform: Platform | string,
  raw: string | null | undefined,
): string | null {
  if (!raw?.trim()) {
    return null;
  }

  if (platform === "douyin") {
    const before = stripDouyinBoilerplate(textBeforeFirstUrl(raw));
    if (before && !isBoilerplateOnly(before)) {
      return before;
    }
    // Rare: content only after URL — scrub carefully
    const after = stripDouyinBoilerplate(textAfterFirstUrl(raw));
    if (after && !isBoilerplateOnly(after)) {
      return after;
    }
    return null;
  }

  if (platform === "x") {
    const before = stripGenericBoilerplate(textBeforeFirstUrl(raw));
    if (before && !isBoilerplateOnly(before)) {
      return before;
    }
    // Tweet text sometimes after URL on its own line
    const after = stripGenericBoilerplate(
      textAfterFirstUrl(raw).replace(/https?:\/\/[^\s]+/gi, " ").replace(/\s+/g, " ").trim(),
    );
    if (after && !isBoilerplateOnly(after)) {
      return after;
    }
    return null;
  }

  let text = raw
    .replace(/https?:\/\/[^\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = stripGenericBoilerplate(text);
  if (!text || isBoilerplateOnly(text)) {
    return null;
  }
  return text;
}

/**
 * Fallback title from URL when share sheet gave link only (common for X).
 * e.g. https://x.com/someone/status/123 → @someone
 */
export function titleFromUrl(platform: Platform | string, url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (platform === "x") {
      const user = path.match(/^\/([A-Za-z0-9_]+)\/status\//)?.[1];
      if (user && user.toLowerCase() !== "i") {
        return `@${user}`;
      }
      return "X 动态";
    }

    if (platform === "douyin") {
      return "抖音视频";
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Prefer existing useful share_text over empty / URL-only / shorter boilerplate.
 */
export function preferShareText(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  const next = incoming?.trim() || null;
  const prev = existing?.trim() || null;
  if (!next) {
    return prev;
  }
  if (!prev) {
    return next;
  }
  if (isWeakShareText(next) && !isWeakShareText(prev)) {
    return prev;
  }
  if (!isWeakShareText(next) && isWeakShareText(prev)) {
    return next;
  }
  return next.length >= prev.length ? next : prev;
}

export function isWeakShareText(text: string | null | undefined): boolean {
  const t = text?.trim() ?? "";
  if (!t) return true;
  if (/^https?:\/\/\S+$/i.test(t)) return true;
  if (isBoilerplateOnly(t)) return true;
  const withoutUrls = t.replace(/https?:\/\/[^\s]+/gi, "").trim();
  if (!withoutUrls) return true;
  if (isBoilerplateOnly(withoutUrls)) return true;
  if ([...withoutUrls].length < 2) return true;
  return false;
}

/**
 * Platforms whose share-sheet text is unreliable (chrome / wrong caption) while
 * the URL is trustworthy — main app fills body via network enrich.
 * Douyin / Bilibili / Kuaishou have no enrich path; keep their share text.
 */
export function usesNetworkEnrichment(platform: string): boolean {
  return platform === "xiaohongshu" || platform === "x";
}

/**
 * Share Extension → inbox:
 * - XHS: discard sheet text; it may belong to another feed/video.
 * - X: keep cleaned text as provisional fallback; network enrich still runs.
 */
export function shareTextFromShareSheet(
  platform: string,
  cleaned: string | null,
  rawText: string | null | undefined,
): string | null {
  // XHS video shares have repeatedly supplied unrelated feed/chrome text.
  // Correctness first: never display it as note metadata; network enrich or link-only.
  if (platform === "xiaohongshu") {
    return null;
  }
  const text = cleaned ?? rawText?.trim() ?? null;
  if (!text || isWeakShareText(text)) {
    return null;
  }
  if (usesNetworkEnrichment(platform)) {
    // Provisional only — still enrich; reject obvious chrome crumbs.
    if (text === "Twitter" || text === "X" || /^@\w+$/.test(text)) {
      return null;
    }
    return text;
  }
  return text;
}

/**
 * When a row was already network-filled, do not let a later share-sheet
 * payload overwrite it with longer junk — unless forceReplace (重新获取).
 */
export function mergeShareTextPreferringEnrichment(
  incoming: string | null | undefined,
  existing: string | null | undefined,
  existingEnriched: boolean,
  forceReplace = false,
): string | null {
  if (forceReplace && incoming?.trim()) {
    return incoming.trim();
  }
  if (existingEnriched && !isWeakShareText(existing)) {
    return existing?.trim() || null;
  }
  return preferShareText(incoming, existing);
}
