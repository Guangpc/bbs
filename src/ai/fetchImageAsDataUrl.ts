import { ensureHttps } from "../parsers/share";

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

function mimeFromContentType(header: string | null, url: string): string {
  const raw = header?.split(";")[0]?.trim().toLowerCase();
  if (raw && raw.startsWith("image/")) {
    return raw === "image/jpg" ? "image/jpeg" : raw;
  }
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Download an image on-device and return a data URI for Zhipu.
 * Platform CDNs often block Zhipu's server-side fetch (防盗链), so local→base64 is more reliable.
 * Returns null on failure / oversized payloads.
 */
export async function fetchImageAsDataUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(ensureHttps(url), {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*",
        "User-Agent": DEFAULT_UA,
      },
    });
    if (!response.ok) {
      return null;
    }
    const mime = mimeFromContentType(response.headers.get("content-type"), url);
    if (!mime.startsWith("image/")) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = globalThis.btoa(binary);
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}
