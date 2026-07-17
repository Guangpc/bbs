export interface XiaohongshuPageMeta {
  title: string | null;
  author: string | null;
  body: string | null;
  noteId: string | null;
  noteType: string | null;
  /** True only when metadata is tied to the expected note via state or og:url. */
  trusted?: boolean;
}

/** Decode common HTML entities used in XHS note pages. */
export function decodeHtmlEntities(text: string): string {
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
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\u200b/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function matchClassInner(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `class="[^"]*\\b${escaped}\\b[^"]*"[^>]*>([\\s\\S]*?)</(?:div|span|p|h1|h2|h3)>`,
    "i",
  );
  const match = html.match(re);
  if (!match) {
    return null;
  }
  const text = stripTags(match[1]);
  return text || null;
}

/** Prefer the note title block (fw500 title), not random "title" in comments. */
function matchNoteTitle(html: string): string | null {
  const specific = html.match(
    /class="[^"]*\bfw500\b[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (specific) {
    const text = stripTags(specific[1]);
    if (text && text !== "小红书") {
      return text;
    }
  }
  const fallback = matchClassInner(html, "note-title");
  if (fallback && fallback !== "小红书") {
    return fallback;
  }
  return null;
}

function matchMetaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
    "i",
  );
  const match = html.match(re) ?? html.match(alt);
  if (!match) {
    return null;
  }
  const text = decodeHtmlEntities(match[1]).trim();
  return text && text !== "小红书" ? text : null;
}

function parseFromDom(html: string): Pick<XiaohongshuPageMeta, "title" | "author" | "body"> {
  const title = matchNoteTitle(html);
  const author = matchClassInner(html, "author-username");
  // Do NOT match bare "desc" — video pages ship many unrelated desc blocks.
  const body = matchClassInner(html, "note-desc-text-opt");

  const cleanedTitle =
    title && title !== "小红书" && title !== author ? title : null;

  return { title: cleanedTitle, author, body };
}

function parseFromOg(html: string): Pick<XiaohongshuPageMeta, "title" | "body"> {
  const ogTitle = matchMetaContent(html, "og:title");
  const ogDesc = matchMetaContent(html, "og:description");
  // og:title is often "标题 - 小红书" or includes site name
  const title = ogTitle
    ?.replace(/\s*[-|｜]\s*小红书\s*$/u, "")
    .replace(/\s*-\s*Xiaohongshu\s*$/iu, "")
    .trim() || null;
  return {
    title: title && title !== "小红书" ? title : null,
    body: ogDesc || null,
  };
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function noteIdOf(note: JsonRecord): string | null {
  if (typeof note.noteId === "string" && note.noteId) {
    return note.noteId;
  }
  if (typeof note.id === "string" && note.id) {
    return note.id;
  }
  return null;
}

/**
 * Video feed pages often put multiple notes in noteDetailMap (current + related).
 * Prefer the entry matching the URL noteId.
 * Without a trusted preferNoteId, multiple entries → refuse (do not pick related).
 */
function pickNoteFromState(state: unknown, preferNoteId: string | null): JsonRecord | null {
  const root = asRecord(state);
  if (!root) {
    return null;
  }

  const noteData = asRecord(root.note);
  const detailMap = asRecord(noteData?.noteDetailMap);
  if (!detailMap) {
    return null;
  }

  const entries = Object.entries(detailMap);
  if (entries.length === 0) {
    return null;
  }

  if (preferNoteId) {
    for (const [key, entry] of entries) {
      if (key === preferNoteId || key.startsWith(preferNoteId)) {
        const wrapped = asRecord(entry);
        const note = asRecord(wrapped?.note);
        if (note) {
          return note;
        }
      }
    }
    for (const [, entry] of entries) {
      const wrapped = asRecord(entry);
      const note = asRecord(wrapped?.note);
      if (note && noteIdOf(note) === preferNoteId) {
        return note;
      }
    }
    // Trusted id present but not in map — do not fall back to a related note.
    return null;
  }

  // Single entry — safe without URL id
  if (entries.length === 1) {
    const wrapped = asRecord(entries[0][1]);
    return asRecord(wrapped?.note);
  }

  // Multiple without trusted id — refuse (video related-feed trap)
  return null;
}

function metaFromNote(note: JsonRecord): Partial<XiaohongshuPageMeta> {
  const user = asRecord(note.user);
  const noteId = noteIdOf(note);
  const title =
    (typeof note.title === "string" && note.title.trim()) ||
    (typeof note.displayTitle === "string" && note.displayTitle.trim()) ||
    null;
  let body =
    (typeof note.desc === "string" && note.desc.trim()) ||
    (typeof note.description === "string" && note.description.trim()) ||
    null;

  // Video notes often put the real caption only in desc; tags can help when desc is thin.
  if (!body || body.length < 4) {
    const tags = Array.isArray(note.tagList)
      ? note.tagList
          .map((t) => {
            const rec = asRecord(t);
            return typeof rec?.name === "string" ? rec.name.trim() : "";
          })
          .filter(Boolean)
      : [];
    if (tags.length > 0) {
      const tagLine = tags.map((t) => `#${t}`).join(" ");
      body = body ? `${body}\n${tagLine}` : tagLine;
    }
  }

  const author =
    (typeof user?.nickname === "string" && user.nickname.trim()) ||
    (typeof user?.nickName === "string" && user.nickName.trim()) ||
    null;
  const noteTypeExplicit =
    (typeof note.type === "string" && note.type) ||
    (typeof note.noteType === "string" && note.noteType) ||
    null;
  // Video notes sometimes omit type but still ship a video payload.
  const noteType =
    noteTypeExplicit ||
    (asRecord(note.video) ? "video" : null);

  return {
    noteId,
    title: title && title !== "小红书" ? title : null,
    body: body || null,
    author,
    noteType,
  };
}

function parseFromInitialState(
  html: string,
  preferNoteId: string | null,
): Partial<XiaohongshuPageMeta> {
  const state = parseInitialStateObject(html);
  if (!state) {
    return {};
  }

  const note = pickNoteFromState(state, preferNoteId);
  if (note) {
    return metaFromNote(note);
  }

  // Do not scrape the first noteId= in HTML — video pages put related ids first.
  return { noteId: preferNoteId };
}

/**
 * Video pages embed huge nested JSON (stream URLs). Regex `\{[\s\S]*?\}` is fragile;
 * walk braces from `window.__INITIAL_STATE__=` like yt-dlp's json search.
 */
export function extractInitialStateRaw(html: string): string | null {
  const marker = /window\.__INITIAL_STATE__\s*=\s*/i.exec(html);
  if (!marker || marker.index === undefined) {
    return null;
  }
  let i = marker.index + marker[0].length;
  while (i < html.length && /\s/.test(html[i]!)) {
    i += 1;
  }
  if (html[i] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  const start = i;

  for (; i < html.length; i += 1) {
    const c = html[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === quote) {
        inString = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** XHS state is JS-ish: undefined / void 0 — normalize then JSON.parse. */
export function parseInitialStateObject(html: string): unknown | null {
  const raw = extractInitialStateRaw(html);
  if (!raw) {
    return null;
  }
  const cleaned = raw
    .replace(/\bundefined\b/g, "null")
    .replace(/\bvoid\s+0\b/g, "null")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function firstUseful(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    const t = c?.trim();
    if (t) {
      return t;
    }
  }
  return null;
}

/**
 * Parse XHS note HTML.
 * @param pageUrl Final URL after redirects — used to pick the correct note when
 *   noteDetailMap contains the current video plus related recommendations.
 * @param expectedNoteId Trusted note id from a prior redirect / caller (not from map guess).
 */
export function parseXiaohongshuHtml(
  html: string,
  pageUrl?: string | null,
  expectedNoteId?: string | null,
): XiaohongshuPageMeta {
  const fromOgUrl = matchMetaContent(html, "og:url");
  const preferNoteId =
    (expectedNoteId && !expectedNoteId.startsWith("s:") ? expectedNoteId : null) ??
    (pageUrl ? extractNoteIdFromUrl(pageUrl) : null) ??
    (fromOgUrl ? extractNoteIdFromUrl(fromOgUrl) : null) ??
    null;

  const fromState = parseFromInitialState(html, preferNoteId);
  const fromOg = parseFromOg(html);
  const fromDom = parseFromDom(html);

  // Only treat state as authoritative when we resolved a note via trusted id or unique map.
  const hasStateNote = !!(fromState.title || fromState.body || fromState.author);
  const stateMatchesExpected =
    hasStateNote &&
    !!preferNoteId &&
    fromState.noteId === preferNoteId;
  const ogNoteId = fromOgUrl ? extractNoteIdFromUrl(fromOgUrl) : null;
  const ogMatchesExpected =
    !!preferNoteId &&
    ogNoteId === preferNoteId &&
    !!(fromOg.title || fromOg.body);

  let title: string | null;
  let body: string | null;
  let author: string | null;

  if (hasStateNote) {
    title = firstUseful(fromState.title);
    body = firstUseful(fromState.body);
    author = firstUseful(fromState.author, fromDom.author);
    if (!title && body) {
      title = body.split(/\n+/)[0]?.trim().slice(0, 80) || null;
    }
    if (!title) {
      title = firstUseful(fromOg.title, fromDom.title);
    }
    if (!body) {
      body = firstUseful(fromOg.body, fromDom.body);
    }
  } else if (preferNoteId) {
    // Trusted id but empty state fields — allow og/dom only as weak fill; caller may reject.
    author = firstUseful(fromDom.author);
    title = firstUseful(fromOg.title, fromDom.title);
    body = firstUseful(fromDom.body, fromOg.body);
    if (!title && body) {
      title = body.split(/\n+/)[0]?.trim().slice(0, 80) || null;
    }
  } else {
    // No trusted id and no unique state note — do not trust og/dom (related feed).
    author = null;
    title = null;
    body = null;
  }

  if (title && author && title === author) {
    title = null;
    if (body) {
      title = body.split(/\n+/)[0]?.trim().slice(0, 80) || null;
    }
  }

  const noteId = preferNoteId ?? fromState.noteId ?? null;

  return {
    title,
    author,
    body,
    noteId,
    noteType: fromState.noteType ?? null,
    trusted: stateMatchesExpected || ogMatchesExpected,
  };
}

/** True when parse result is safe to persist (not a related-feed guess). */
export function isCredibleXiaohongshuMeta(
  meta: XiaohongshuPageMeta,
  expectedNoteId: string | null,
  finalUrl: string,
): boolean {
  const urlId = extractNoteIdFromUrl(finalUrl);
  const trusted = expectedNoteId && !expectedNoteId.startsWith("s:") ? expectedNoteId : urlId;
  if (!trusted) {
    return false;
  }
  if (!meta.noteId || meta.noteId !== trusted) {
    return false;
  }
  if (!meta.trusted) {
    return false;
  }
  return !!(meta.title?.trim() || meta.body?.trim());
}

export function formatXiaohongshuShareText(meta: XiaohongshuPageMeta): string | null {
  const parts: string[] = [];
  const title =
    meta.title?.trim() ||
    meta.body?.split(/\n+/)[0]?.trim().slice(0, 80) ||
    null;
  if (title) {
    parts.push(title);
  }
  if (meta.author) {
    parts.push(`作者：${meta.author}`);
  }
  if (meta.body && meta.body !== title) {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push(meta.body);
  }
  const text = parts.join("\n").trim();
  return text || null;
}

export function extractNoteIdFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    return (
      pathname.match(/\/(?:discovery\/item|explore|note)\/([0-9A-Za-z]+)/)?.[1] ?? null
    );
  } catch {
    return null;
  }
}
