import { ensureHttps, extractExternalId } from "../parsers/share";

export interface XPageMeta {
  text: string | null;
  author: string | null;
  statusId: string | null;
}

export interface FetchXResult {
  finalUrl: string;
  meta: XPageMeta;
  shareText: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function statusIdFromUrl(url: string): string | null {
  return extractExternalId("x", url);
}

function screenNameFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.match(/^\/([A-Za-z0-9_]+)\/status\//)?.[1] ?? null;
  } catch {
    return null;
  }
}

function formatXShareText(meta: XPageMeta): string | null {
  const parts: string[] = [];
  if (meta.text) {
    parts.push(meta.text);
  }
  if (meta.author) {
    parts.push(`作者：@${meta.author.replace(/^@/, "")}`);
  }
  const text = parts.join("\n").trim();
  return text || null;
}

async function fetchFxTwitter(
  statusId: string,
  fetchImpl: typeof fetch,
): Promise<XPageMeta | null> {
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
  const data = (await response.json()) as {
    tweet?: {
      text?: string;
      author?: { screen_name?: string; name?: string };
    };
    text?: string;
  };
  const tweet = data.tweet;
  const text = tweet?.text?.trim() || data.text?.trim() || null;
  const author = tweet?.author?.screen_name?.trim() || null;
  if (!text && !author) {
    return null;
  }
  return { text, author, statusId };
}

async function fetchOEmbed(url: string, fetchImpl: typeof fetch): Promise<XPageMeta | null> {
  const endpoint = `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(url)}`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": DEFAULT_UA },
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    html?: string;
    author_name?: string;
    author_url?: string;
  };
  const htmlText = data.html ? stripTags(data.html) : null;
  // oEmbed blockquote often ends with "— Author (@handle)"
  let text: string | null = htmlText
    ? htmlText
        .replace(/\s*—\s*.*$/u, "")
        .replace(/\s*https?:\/\/t\.co\/\S+/gi, "")
        .trim()
    : null;
  if (text && text.length < 2) {
    text = null;
  }
  const handle: string | null =
    data.author_url?.match(/\/([A-Za-z0-9_]+)\/?$/)?.[1] ??
    screenNameFromUrl(url) ??
    null;
  if (!text && !handle) {
    return null;
  }
  return {
    text,
    author: handle,
    statusId: statusIdFromUrl(url),
  };
}

async function fetchOgDescription(url: string, fetchImpl: typeof fetch): Promise<XPageMeta | null> {
  const response = await fetchImpl(ensureHttps(url), {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": DEFAULT_UA,
      "Accept-Language": "en-US,en;q=0.9,zh;q=0.8",
    },
  });
  if (!response.ok) {
    return null;
  }
  const html = await response.text();
  const og =
    html.match(
      /property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
    )?.[1] ??
    html.match(
      /content=["']([^"']*)["'][^>]*property=["']og:description["']/i,
    )?.[1] ??
    null;
  const text = og ? decodeHtmlEntities(og).trim() : null;
  if (!text) {
    return null;
  }
  return {
    text,
    author: screenNameFromUrl(response.url || url),
    statusId: statusIdFromUrl(response.url || url),
  };
}

/**
 * Resolve tweet body for an X/Twitter status URL.
 * Tries FxTwitter → oEmbed → og:description. Soft-fail by throwing.
 */
export async function fetchXStatus(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchXResult> {
  const secureUrl = ensureHttps(url).replace("://twitter.com/", "://x.com/");
  const statusId = statusIdFromUrl(secureUrl);
  if (!statusId) {
    throw new Error("不是有效的 X 推文链接");
  }

  let meta: XPageMeta | null = null;
  try {
    meta = await fetchFxTwitter(statusId, fetchImpl);
  } catch {
    meta = null;
  }
  if (!meta?.text) {
    try {
      meta = (await fetchOEmbed(secureUrl, fetchImpl)) ?? meta;
    } catch {
      // continue
    }
  }
  if (!meta?.text) {
    try {
      meta = (await fetchOgDescription(secureUrl, fetchImpl)) ?? meta;
    } catch {
      // continue
    }
  }

  if (!meta) {
    meta = {
      text: null,
      author: screenNameFromUrl(secureUrl),
      statusId,
    };
  }
  if (!meta.author) {
    meta.author = screenNameFromUrl(secureUrl);
  }
  if (!meta.statusId) {
    meta.statusId = statusId;
  }

  const shareText = formatXShareText(meta);
  if (!shareText || !meta.text) {
    throw new Error("未能获取该推文正文");
  }

  return {
    finalUrl: `https://x.com/${meta.author ?? "i"}/status/${statusId}`,
    meta,
    shareText,
  };
}
