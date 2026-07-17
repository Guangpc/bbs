import { ensureHttps } from "../parsers/share";

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Extract og:image / twitter:image from HTML. */
export function extractOgImageUrl(html: string): string | null {
  const patterns = [
    /property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i,
    /name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re)?.[1];
    if (match) {
      const url = decodeHtmlEntities(match).trim();
      if (/^https?:\/\//i.test(url)) {
        return ensureHttps(url);
      }
    }
  }
  return null;
}

/** FxTwitter media thumbnail when available. */
export function coverFromFxTwitterJson(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const root = data as {
    tweet?: {
      media?: {
        photos?: Array<{ url?: string }>;
        videos?: Array<{ thumbnail_url?: string; url?: string }>;
      };
    };
  };
  const media = root.tweet?.media;
  const photo = media?.photos?.[0]?.url?.trim();
  if (photo && /^https?:\/\//i.test(photo)) {
    return ensureHttps(photo);
  }
  const videoThumb = media?.videos?.[0]?.thumbnail_url?.trim();
  if (videoThumb && /^https?:\/\//i.test(videoThumb)) {
    return ensureHttps(videoThumb);
  }
  return null;
}

async function fetchHtmlOgImage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const response = await fetchImpl(ensureHttps(url), {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": DEFAULT_UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) {
    return null;
  }
  const html = await response.text();
  return extractOgImageUrl(html);
}

async function fetchFxTwitterCover(
  statusId: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const response = await fetchImpl(`https://api.fxtwitter.com/status/${statusId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": DEFAULT_UA,
    },
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return coverFromFxTwitterJson(data);
}

function statusIdFromXUrl(url: string): string | null {
  try {
    return new URL(url).pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort public cover/thumbnail URL for multimodal summarize.
 * Never throws — returns null when unavailable.
 */
export async function resolveCoverUrl(options: {
  platform: string;
  pageUrl: string | null;
  cachedCoverUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const cached = options.cachedCoverUrl?.trim();
  if (cached && /^https?:\/\//i.test(cached)) {
    return ensureHttps(cached);
  }

  const pageUrl = options.pageUrl?.trim();
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const secure = ensureHttps(pageUrl);

  try {
    if (options.platform === "x") {
      const statusId = statusIdFromXUrl(secure);
      if (statusId) {
        const fromFx = await fetchFxTwitterCover(statusId, fetchImpl);
        if (fromFx) {
          return fromFx;
        }
      }
    }
    return await fetchHtmlOgImage(secure, fetchImpl);
  } catch {
    return null;
  }
}
