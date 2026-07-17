import { ensureHttps } from "../parsers/share";
import {
  extractNoteIdFromUrl,
  formatXiaohongshuShareText,
  isCredibleXiaohongshuMeta,
  parseXiaohongshuHtml,
  type XiaohongshuPageMeta,
} from "./xiaohongshuHtml";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export interface FetchXiaohongshuResult {
  finalUrl: string;
  html: string;
  meta: XiaohongshuPageMeta;
  shareText: string;
}

function getQueryParam(url: string, key: string): string | null {
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

function copySecurityParams(fromUrl: string, toUrl: string): string {
  try {
    const dest = new URL(toUrl);
    for (const key of ["xsec_token", "xsec_source", "share_id", "share_channel"]) {
      const value = getQueryParam(fromUrl, key);
      if (value && !dest.searchParams.has(key)) {
        dest.searchParams.set(key, value);
      }
    }
    return dest.toString();
  } catch {
    return toUrl;
  }
}

/** Only accept note ids that came from a URL path — never from map guessing. */
function trustedNoteIdFromUrl(url: string): string | null {
  return extractNoteIdFromUrl(url);
}

/** Explore / discovery variants — video notes often SSR on one path but not the other. */
export function buildXiaohongshuCandidateUrls(
  seedUrl: string,
  noteId: string | null,
): string[] {
  const seed = ensureHttps(seedUrl);
  const out: string[] = [seed];

  if (noteId && !noteId.startsWith("s:")) {
    for (const path of [`/explore/${noteId}`, `/discovery/item/${noteId}`]) {
      out.push(copySecurityParams(seed, `https://www.xiaohongshu.com${path}`));
    }
  }

  const seen = new Set<string>();
  return out.filter((u) => {
    if (seen.has(u)) {
      return false;
    }
    seen.add(u);
    return true;
  });
}

function tryBuildResult(
  finalUrl: string,
  html: string,
  expectedNoteId: string | null,
): FetchXiaohongshuResult | null {
  const urlId = trustedNoteIdFromUrl(finalUrl);
  const expected = expectedNoteId && !expectedNoteId.startsWith("s:") ? expectedNoteId : urlId;
  // Without a URL-level note id, refuse — video pages with related map would guess wrong.
  if (!expected) {
    return null;
  }

  const meta = parseXiaohongshuHtml(html, finalUrl, expected);
  if (!isCredibleXiaohongshuMeta(meta, expected, finalUrl)) {
    return null;
  }

  const shareText = formatXiaohongshuShareText(meta);
  if (!shareText) {
    return null;
  }
  return { finalUrl, html, meta, shareText };
}

async function fetchHtmlOnce(
  url: string,
  userAgent: string,
  fetchImpl: typeof fetch,
): Promise<{ finalUrl: string; html: string } | null> {
  try {
    const response = await fetchImpl(ensureHttps(url), {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": userAgent,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.xiaohongshu.com/",
      },
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    if (!html || html.length < 50) {
      return null;
    }
    return { finalUrl: ensureHttps(response.url || url), html };
  } catch {
    return null;
  }
}

/**
 * Resolve Xiaohongshu note text with a credibility gate:
 * short-link resolve → URL noteId → parse only that note → reject related-feed guesses.
 */
export async function fetchXiaohongshuPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchXiaohongshuResult> {
  const seed = ensureHttps(url);
  let trustedNoteId = trustedNoteIdFromUrl(seed);
  let tokenBearer = seed;

  for (const ua of [MOBILE_UA, DESKTOP_UA]) {
    const candidates = buildXiaohongshuCandidateUrls(tokenBearer, trustedNoteId);

    for (const candidate of candidates) {
      const page = await fetchHtmlOnce(candidate, ua, fetchImpl);
      if (!page) {
        continue;
      }

      tokenBearer = page.finalUrl;
      const urlId = trustedNoteIdFromUrl(page.finalUrl);
      if (urlId) {
        trustedNoteId = urlId;
      }

      const result = tryBuildResult(page.finalUrl, page.html, trustedNoteId);
      if (result) {
        return result;
      }
    }

    // Expand with noteId discovered only from redirect URL (never from map guess).
    if (trustedNoteId) {
      for (const candidate of buildXiaohongshuCandidateUrls(tokenBearer, trustedNoteId)) {
        if (candidates.includes(candidate)) {
          continue;
        }
        const page = await fetchHtmlOnce(candidate, ua, fetchImpl);
        if (!page) {
          continue;
        }
        const urlId = trustedNoteIdFromUrl(page.finalUrl);
        if (urlId) {
          trustedNoteId = urlId;
        }
        const result = tryBuildResult(page.finalUrl, page.html, trustedNoteId);
        if (result) {
          return result;
        }
      }
    }
  }

  throw new Error("未能可信解析小红书笔记（缺少 noteId 或命中相关推荐）");
}
