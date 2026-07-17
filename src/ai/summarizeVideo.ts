import type { VideoRow } from "../db/schema";
import { fetchImageAsDataUrl } from "./fetchImageAsDataUrl";
import { isMediaParseError, type LlmContentPart, llmChatCompletion } from "./llmChat";
import { getLlmProvider, type LlmProvider } from "./providers";
import type { SummaryMediaBasis } from "./resolveMedia";

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  bilibili: "B站",
  xiaohongshu: "小红书",
  kuaishou: "快手",
  x: "X",
  unknown: "未知",
};

export function summaryButtonLabel(video: Pick<VideoRow, "ai_summary">): string {
  return video.ai_summary?.trim() ? "查看总结" : "一键总结";
}

export function hasSavedAiSummary(video: Pick<VideoRow, "ai_summary">): boolean {
  return !!video.ai_summary?.trim();
}

export function buildSummarizePrompt(input: {
  platform: string;
  shareText: string | null;
  url: string | null;
  basis: SummaryMediaBasis;
}): string {
  const platformLabel = PLATFORM_LABEL[input.platform] ?? input.platform;
  const body = input.shareText?.trim() || "（无正文/标题，仅有链接）";
  const urlLine = input.url?.trim() || "（无链接）";
  const mediaHint =
    input.basis === "video"
      ? "我附上了可播放的视频直链，请以视频画面和声音内容为主来总结，文字只作辅助。"
      : input.basis === "cover"
        ? "我附了一张封面图（没有可用视频直链），请结合封面和文字总结；不要假装看过完整视频。"
        : "没有视频直链也没有封面图，就按文字和链接来猜；信息不够时直接说「信息有限，只能根据标题/链接大概说说」。";

  return [
    "你是我的私人收藏助手，帮我快速回想这条内容在讲什么。",
    "说话像朋友随口转述：口语、自然、有点温度，不要公文腔，也不要「首先/其次/综上所述」。",
    mediaHint,
    "",
    "怎么写：",
    "- 直接告诉我内容是什么，用 2～5 句连贯短文说完；",
    "- 不要分点、不要标题、不要序号、不要「主题/要点/总结」这类栏目；",
    "- 把关键细节融进叙述里（谁、在说啥、有啥干货或情绪），别编造原文没有的东西；",
    "- 篇幅短一点，扫一眼就能看完。",
    "",
    `平台：${platformLabel}`,
    `链接：${urlLine}`,
    `标题/正文：`,
    body,
  ].join("\n");
}

/**
 * Build multimodal content with exclusive media:
 * video_url XOR image_url XOR text-only (Zhipu forbids mixing video/image/file).
 */
export function buildSummarizeContent(input: {
  platform: string;
  shareText: string | null;
  url: string | null;
  videoUrl?: string | null;
  coverUrl: string | null;
  supportsVision?: boolean;
  supportsVideo?: boolean;
}): { content: LlmContentPart[]; basis: SummaryMediaBasis } {
  const allowVideo = input.supportsVideo === true;
  const allowVision = input.supportsVision !== false;
  const video = allowVideo ? input.videoUrl?.trim() || null : null;
  const cover = !video && allowVision ? input.coverUrl?.trim() || null : null;
  const basis: SummaryMediaBasis = video ? "video" : cover ? "cover" : "text";

  const text = buildSummarizePrompt({
    platform: input.platform,
    shareText: input.shareText,
    url: input.url,
    basis,
  });

  const parts: LlmContentPart[] = [];
  if (video) {
    parts.push({ type: "video_url", video_url: { url: video } });
  } else if (cover) {
    parts.push({ type: "image_url", image_url: { url: cover } });
  }
  parts.push({ type: "text", text });
  return { content: parts, basis };
}

async function callOnce(options: {
  apiKey: string;
  provider: LlmProvider;
  platform: string;
  shareText: string | null;
  url: string | null;
  videoUrl?: string | null;
  coverUrl: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ summary: string; basis: SummaryMediaBasis }> {
  const { content, basis } = buildSummarizeContent({
    platform: options.platform,
    shareText: options.shareText,
    url: options.url,
    videoUrl: options.videoUrl,
    coverUrl: options.coverUrl,
    supportsVision: options.provider.supportsVision,
    supportsVideo: options.provider.supportsVideo,
  });
  const summary = await llmChatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    content,
    fetchImpl: options.fetchImpl,
  });
  return { summary, basis };
}

/**
 * Summarize with cascade:
 * video URL → cover URL → cover as local base64 → text-only.
 * Media parse errors from the provider trigger the next step instead of failing the whole action.
 */
export async function summarizeVideoContent(options: {
  apiKey: string;
  provider?: LlmProvider;
  platform: string;
  shareText: string | null;
  url: string | null;
  videoUrl?: string | null;
  coverUrl: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ summary: string; basis: SummaryMediaBasis; degradedFrom?: string }> {
  const provider = options.provider ?? getLlmProvider("zhipu");
  const fetchImpl = options.fetchImpl ?? fetch;
  const cover = options.coverUrl?.trim() || null;
  const video = options.videoUrl?.trim() || null;

  // 1) Prefer video direct URL when available.
  if (video && provider.supportsVideo) {
    try {
      return await callOnce({
        ...options,
        provider,
        videoUrl: video,
        coverUrl: null,
        fetchImpl,
      });
    } catch (error) {
      if (!isMediaParseError(error)) {
        throw error;
      }
      // fall through to cover / text
    }
  }

  // 2) Cover as remote URL (works when CDN is publicly readable by the model host).
  if (cover && provider.supportsVision) {
    try {
      return await callOnce({
        ...options,
        provider,
        videoUrl: null,
        coverUrl: cover,
        fetchImpl,
      });
    } catch (error) {
      if (!isMediaParseError(error)) {
        throw error;
      }
    }

    // 3) Cover downloaded on-device → base64 data URI (bypasses CDN 防盗链 for model servers).
    const dataUrl = await fetchImageAsDataUrl(cover, fetchImpl);
    if (dataUrl) {
      try {
        return await callOnce({
          ...options,
          provider,
          videoUrl: null,
          coverUrl: dataUrl,
          fetchImpl,
        });
      } catch (error) {
        if (!isMediaParseError(error)) {
          throw error;
        }
      }
    }
  }

  // 4) Text-only fallback — still useful, and never fails for media format reasons.
  const textOnly = await callOnce({
    ...options,
    provider,
    videoUrl: null,
    coverUrl: null,
    fetchImpl,
  });
  return {
    ...textOnly,
    degradedFrom:
      video || cover
        ? "媒体链接模型侧无法解析，已降级为纯文字"
        : undefined,
  };
}
