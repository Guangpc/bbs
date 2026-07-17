/**
 * Smoke tests for AI summarize helpers.
 * Run: npx --yes tsx scripts/test-summarize.ts
 */
import {
  buildSummarizeContent,
  buildSummarizePrompt,
  hasSavedAiSummary,
  summaryButtonLabel,
} from "../src/ai/summarizeVideo";
import {
  coverFromFxTwitterJson,
  extractOgImageUrl,
} from "../src/ai/resolveCoverUrl";
import {
  extractOgVideoUrl,
  looksLikeVideoUrl,
  pickVideoUrlFromObject,
  summaryBasisLabel,
  videoFromFxTwitterJson,
} from "../src/ai/resolveMedia";
import { isMediaParseError } from "../src/ai/llmChat";
import { getLlmProvider, LLM_PROVIDERS } from "../src/ai/providers";

function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) {
    process.exitCode = 1;
  }
}

assert("button label empty → 一键总结", summaryButtonLabel({ ai_summary: null }) === "一键总结");
assert(
  "button label whitespace → 一键总结",
  summaryButtonLabel({ ai_summary: "  " }) === "一键总结",
);
assert(
  "button label saved → 查看总结",
  summaryButtonLabel({ ai_summary: "这是总结" }) === "查看总结",
);
assert("hasSavedAiSummary true", hasSavedAiSummary({ ai_summary: "ok" }));
assert("hasSavedAiSummary false", !hasSavedAiSummary({ ai_summary: null }));

const prompt = buildSummarizePrompt({
  platform: "xiaohongshu",
  shareText: "周末徒步路线分享",
  url: "https://www.xiaohongshu.com/explore/abc",
  basis: "text",
});
assert("prompt mentions platform", prompt.includes("小红书"));
assert("prompt mentions body", prompt.includes("周末徒步路线分享"));
assert("prompt no-cover hint", prompt.includes("信息有限"));
assert("prompt asks for prose not bullets", prompt.includes("不要分点"));

const withCover = buildSummarizePrompt({
  platform: "x",
  shareText: "hello",
  url: "https://x.com/a/status/1",
  basis: "cover",
});
assert("prompt cover hint", withCover.includes("封面图"));

const withVideo = buildSummarizePrompt({
  platform: "x",
  shareText: "hello",
  url: "https://x.com/a/status/1",
  basis: "video",
});
assert("prompt video hint", withVideo.includes("视频直链"));

const textOnly = buildSummarizeContent({
  platform: "douyin",
  shareText: "舞蹈教程",
  url: "https://v.douyin.com/x/",
  coverUrl: null,
});
assert("text-only one part", textOnly.content.length === 1 && textOnly.content[0].type === "text");
assert("text-only basis", textOnly.basis === "text");

const multimodal = buildSummarizeContent({
  platform: "xiaohongshu",
  shareText: "封面笔记",
  url: "https://www.xiaohongshu.com/explore/1",
  coverUrl: "https://cdn.example.com/cover.jpg",
  supportsVision: true,
});
assert(
  "multimodal image then text",
  multimodal.content.length === 2 &&
    multimodal.content[0].type === "image_url" &&
    multimodal.content[1].type === "text",
);
assert("cover basis", multimodal.basis === "cover");

const videoContent = buildSummarizeContent({
  platform: "x",
  shareText: "推特视频",
  url: "https://x.com/a/status/1",
  videoUrl: "https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/a.mp4",
  coverUrl: "https://cdn.example.com/cover.jpg",
  supportsVision: true,
  supportsVideo: true,
});
assert("video beats cover", videoContent.basis === "video");
assert(
  "video part not mixed with image",
  videoContent.content.length === 2 &&
    videoContent.content[0].type === "video_url" &&
    videoContent.content[1].type === "text",
);

const visionOff = buildSummarizeContent({
  platform: "deepseek",
  shareText: "纯文本模型",
  url: "https://example.com",
  coverUrl: "https://cdn.example.com/cover.jpg",
  videoUrl: "https://cdn.example.com/a.mp4",
  supportsVision: false,
  supportsVideo: false,
});
assert(
  "no vision/video → text only",
  visionOff.content.length === 1 && visionOff.content[0].type === "text",
);

assert("providers include zhipu+kimi+deepseek+openai+qwen+claude+gemini", LLM_PROVIDERS.length >= 7);
assert("zhipu vision on", getLlmProvider("zhipu").supportsVision === true);
assert("zhipu video on", getLlmProvider("zhipu").supportsVideo === true);
assert("deepseek vision off", getLlmProvider("deepseek").supportsVision === false);
assert("claude is anthropic", getLlmProvider("claude").protocol === "anthropic");
assert("kimi openai endpoint", getLlmProvider("kimi").endpoint.includes("moonshot"));
assert("basis label video", summaryBasisLabel("video").includes("视频"));

const ogHtml = `
<html><head>
<meta property="og:image" content="https://sns-webpic.xhscdn.com/note/cover.jpg?imageView2" />
<meta property="og:video" content="https://sns-video-bd.xhscdn.com/stream/a.mp4" />
</head></html>`;
assert(
  "extract og:image",
  extractOgImageUrl(ogHtml) === "https://sns-webpic.xhscdn.com/note/cover.jpg?imageView2",
);
assert(
  "extract og:video",
  extractOgVideoUrl(ogHtml) === "https://sns-video-bd.xhscdn.com/stream/a.mp4",
);

assert("looksLikeVideoUrl mp4", looksLikeVideoUrl("https://cdn.example.com/a.mp4"));
assert("looksLikeVideoUrl page false", !looksLikeVideoUrl("https://www.xiaohongshu.com/explore/abc"));

assert(
  "pickVideoUrlFromObject prefers mp4",
  pickVideoUrlFromObject({
    media: {
      stream: {
        h264: [{ masterUrl: "https://cdn.example.com/a.m3u8" }, { masterUrl: "https://cdn.example.com/b.mp4" }],
      },
    },
  }) === "https://cdn.example.com/b.mp4",
);

const fx = coverFromFxTwitterJson({
  tweet: {
    media: {
      photos: [{ url: "http://pbs.twimg.com/media/ABC.jpg" }],
    },
  },
});
assert("fx photo upgraded to https", fx === "https://pbs.twimg.com/media/ABC.jpg");

const fxVideo = coverFromFxTwitterJson({
  tweet: {
    media: {
      videos: [{ thumbnail_url: "https://pbs.twimg.com/ext_tw_video_thumb/1/img.jpg" }],
    },
  },
});
assert(
  "fx video thumb",
  fxVideo === "https://pbs.twimg.com/ext_tw_video_thumb/1/img.jpg",
);

assert(
  "fx video url",
  videoFromFxTwitterJson({
    tweet: {
      media: {
        videos: [{ url: "https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/x.mp4" }],
      },
    },
  }) === "https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/x.mp4",
);

assert("fx empty → null", coverFromFxTwitterJson({}) === null);

assert(
  "detects zhipu image parse error",
  isMediaParseError(new Error("图片输入格式/解析错误")),
);
assert("ignores unrelated errors", !isMediaParseError(new Error("API Key 无效")));

if (process.exitCode) {
  console.error("Some summarize tests failed");
} else {
  console.log("All summarize tests passed");
}
