import * as Linking from "expo-linking";

import type { VideoRow } from "../db/schema";
import { buildOpenUrlCandidates } from "./openCandidates";

export { buildOpenUrlCandidates } from "./openCandidates";

/**
 * Prefer native app schemes; fall back to https (may open Safari for XHS).
 */
export async function openOriginalContent(video: VideoRow): Promise<string> {
  const candidates = buildOpenUrlCandidates(video);
  if (candidates.length === 0) {
    throw new Error("没有可打开的链接");
  }

  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          continue;
        }
      }
      await Linking.openURL(url);
      return url;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("无法打开链接");
}
