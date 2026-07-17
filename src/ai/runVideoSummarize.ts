import type { SQLiteDatabase } from "expo-sqlite";

import {
  updateVideoAiSummary,
  updateVideoMediaCache,
} from "../db/repository";
import { listLiveVideos, type VideoRow } from "../db/schema";
import {
  enrichVideosMetadata,
  hasUsefulShareText,
} from "../metadata/enrichVideos";
import { usesNetworkEnrichment } from "../parsers/titles";
import { getLlmApiKey } from "./llmApiKeyStore";
import { getLlmProvider } from "./providers";
import {
  resolveSummarizeMedia,
  summaryBasisLabel,
  type SummaryMediaBasis,
} from "./resolveMedia";
import { summarizeVideoContent } from "./summarizeVideo";

function primaryUrl(video: VideoRow): string | null {
  return video.canonical_url ?? video.normalized_url ?? video.original_url ?? null;
}

/**
 * Before calling the model: if this platform can network-enrich and text is still
 * useless, run a silent one-shot enrich for this id.
 */
export async function ensureShareTextForSummarize(
  db: SQLiteDatabase,
  video: VideoRow,
  options?: { fetchImpl?: typeof fetch },
): Promise<VideoRow> {
  if (!usesNetworkEnrichment(video.platform) || hasUsefulShareText(video)) {
    return video;
  }

  await enrichVideosMetadata(db, {
    videoIds: [video.id],
    limit: 1,
    fetchImpl: options?.fetchImpl,
  });

  const rows = await listLiveVideos(db);
  return rows.find((row) => row.id === video.id) ?? video;
}

export interface RunSummarizeResult {
  video: VideoRow;
  summary: string;
  basis: SummaryMediaBasis;
  basisLabel: string;
  providerLabel: string;
  /** Set when we intended media but had to fall back. */
  degradedNote?: string;
}

/**
 * Full one-click / re-summarize pipeline:
 * silent enrich → resolve video|cover → LLM (with media→text cascade) → persist.
 * App summarize always uses Zhipu GLM-5V-Turbo.
 */
export async function runVideoSummarize(
  db: SQLiteDatabase,
  video: VideoRow,
  options?: { fetchImpl?: typeof fetch },
): Promise<RunSummarizeResult> {
  const provider = getLlmProvider("zhipu");
  const apiKey = await getLlmApiKey("zhipu");
  if (!apiKey) {
    throw new Error("未配置智谱 API Key。请在设置中粘贴后重试。");
  }

  let current = await ensureShareTextForSummarize(db, video, options);
  const pageUrl = primaryUrl(current);

  const media = await resolveSummarizeMedia({
    platform: current.platform,
    pageUrl,
    cachedCoverUrl: current.cover_url,
    cachedMediaUrl: current.media_url,
    wantVideo: provider.supportsVideo,
    fetchImpl: options?.fetchImpl,
  });

  await updateVideoMediaCache(db, current.id, {
    coverUrl: media.coverUrl,
    mediaUrl: media.videoUrl,
  });

  const { summary, basis, degradedFrom } = await summarizeVideoContent({
    apiKey,
    provider,
    platform: current.platform,
    shareText: current.share_text,
    url: pageUrl,
    videoUrl: media.videoUrl,
    coverUrl: media.coverUrl,
    fetchImpl: options?.fetchImpl,
  });

  // If remote media failed and we ended on text, drop stale media cache so next run re-resolves.
  if (basis === "text" && media.videoUrl) {
    await updateVideoMediaCache(db, current.id, {
      mediaUrl: null,
    });
  }

  await updateVideoAiSummary(db, current.id, summary, basis);

  const rows = await listLiveVideos(db);
  current = rows.find((row) => row.id === current.id) ?? {
    ...current,
    ai_summary: summary,
    ai_summarized_at: Date.now(),
    ai_summary_basis: basis,
    cover_url: media.coverUrl ?? current.cover_url,
    media_url: basis === "video" ? media.videoUrl : current.media_url,
  };

  const basisLabel = degradedFrom
    ? `${summaryBasisLabel(basis)}（${degradedFrom}）`
    : summaryBasisLabel(basis);

  return {
    video: current,
    summary,
    basis,
    basisLabel,
    providerLabel: provider.label,
    degradedNote: degradedFrom,
  };
}
