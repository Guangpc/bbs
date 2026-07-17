/**
 * Smoke tests for title cleaning + XHS HTML parsing.
 * Run: npx --yes tsx scripts/test-parsers.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractExternalId, pickPrimaryUrl, toCanonicalUrl } from "../src/parsers/share";
import {
  cleanShareText,
  mergeShareTextPreferringEnrichment,
  preferShareText,
  shareTextFromShareSheet,
  titleFromUrl,
  usesNetworkEnrichment,
} from "../src/parsers/titles";
import { parseXiaohongshuHtml, formatXiaohongshuShareText, extractInitialStateRaw, isCredibleXiaohongshuMeta } from "../src/metadata/xiaohongshuHtml";
import { buildXiaohongshuCandidateUrls } from "../src/metadata/fetchXiaohongshu";
import { needsNetworkEnrichment, needsXiaohongshuEnrichment, needsXEnrichment } from "../src/metadata/enrichVideos";
import { buildOpenUrlCandidates } from "../src/open/openCandidates";

function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) {
    process.exitCode = 1;
  }
}

const douyinRaw =
  "9.99 今天天气真好 https://v.douyin.com/IeAbc12/ 复制此链接，打开Dou音搜索，直接观看视频！";
const douyinClean = cleanShareText("douyin", douyinRaw);
assert("douyin strips boilerplate", !!douyinClean && !/复制|打开Dou|观看视频/.test(douyinClean));
assert("douyin keeps content", !!douyinClean && douyinClean.includes("今天天气真好"));

const douyinCopyOpen =
  "复制打开抖音，看看【作者名】的精彩内容！ https://v.douyin.com/IeAbc12/";
const douyinCopyClean = cleanShareText("douyin", douyinCopyOpen);
assert(
  "douyin copy-open keeps author bracket",
  !!douyinCopyClean && douyinCopyClean.includes("作者名") && !douyinCopyClean.includes("复制"),
);

const douyinOnlyTail =
  "https://v.douyin.com/IeAbc12/ 复制此链接，打开Dou音搜索，直接观看视频！";
assert("douyin url-only tail → null", cleanShareText("douyin", douyinOnlyTail) === null);

assert(
  "x title from tweet text",
  cleanShareText("x", "Hello world from X https://x.com/foo/status/1") === "Hello world from X",
);
assert("x url-only → null clean", cleanShareText("x", "https://x.com/foo/status/1") === null);

assert(
  "x titleFromUrl @user",
  titleFromUrl("x", "https://x.com/elonmusk/status/123") === "@elonmusk",
);
assert(
  "prefer keeps rich over empty",
  preferShareText(null, "好标题\n作者：甲") === "好标题\n作者：甲",
);
assert(
  "prefer keeps rich over url-only",
  preferShareText("https://xhslink.com/m/abc", "好标题") === "好标题",
);

assert(
  "douyin short external id",
  extractExternalId("douyin", "https://v.douyin.com/IeAbc12/") === "s:IeAbc12",
);
assert(
  "douyin video external id",
  extractExternalId("douyin", "https://www.douyin.com/video/7123456789") === "7123456789",
);
assert(
  "xhs note canonical",
  toCanonicalUrl(
    "xiaohongshu",
    "https://www.xiaohongshu.com/explore/6a58a4d80000000001003e67?xsec_token=1",
  ) === "https://www.xiaohongshu.com/discovery/item/6a58a4d80000000001003e67",
);

// Multi-URL share payloads: never blindly take urls[0]
assert(
  "xhs pick short link over homepage",
  pickPrimaryUrl(
    ["https://www.xiaohongshu.com/", "http://xhslink.com/m/AbcDef"],
    null,
  ) === "https://xhslink.com/m/AbcDef",
);
assert(
  "xhs pick note path over profile",
  pickPrimaryUrl(
    [
      "https://www.xiaohongshu.com/user/profile/5f0000000000000000000001",
      "https://www.xiaohongshu.com/explore/6a58a4d80000000001003e67",
    ],
    null,
  ) === "https://www.xiaohongshu.com/explore/6a58a4d80000000001003e67",
);
assert(
  "xhs pick short link from rawText when urls are junk",
  pickPrimaryUrl(
    ["https://apps.apple.com/cn/app/id741292507"],
    "看这篇 https://xhslink.com/m/RealNote",
  ) === "https://xhslink.com/m/RealNote",
);
assert(
  "xhs demote app store",
  pickPrimaryUrl(
    [
      "https://apps.apple.com/cn/app/id741292507",
      "https://www.xiaohongshu.com/discovery/item/6a58a4d80000000001003e67",
    ],
    null,
  ) === "https://www.xiaohongshu.com/discovery/item/6a58a4d80000000001003e67",
);

// Share-sheet junk text must not block XHS network enrich
const shareSheetJunk = {
  id: "1",
  ingest_id: "ingest-1",
  platform: "xiaohongshu",
  original_url: "https://xhslink.com/m/abc",
  normalized_url: "https://xhslink.com/m/abc",
  canonical_url: null,
  external_id: "s:abc",
  share_text: "小红书视频 · 推荐内容", // looks useful, but wrong
  comment: null,
  status: "unread",
  is_pinned: 0,
  open_count: 0,
  last_opened_at: null,
  watched_at: null,
  meta_enriched_at: null,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
};
assert(
  "xhs share junk still needs enrich",
  needsXiaohongshuEnrichment(shareSheetJunk as never),
);
assert(
  "xhs after network enrich skips",
  !needsXiaohongshuEnrichment({ ...shareSheetJunk, meta_enriched_at: 1 } as never),
);
assert(
  "xhs paste with text skips enrich",
  !needsXiaohongshuEnrichment({
    ...shareSheetJunk,
    ingest_id: null,
    share_text: "真正的标题\n作者：甲",
  } as never),
);
assert("xhs+x use network enrich", usesNetworkEnrichment("xiaohongshu") && usesNetworkEnrichment("x"));
assert("douyin keeps share-sheet text", !usesNetworkEnrichment("douyin"));
assert(
  "share sheet discards xhs chrome only",
  shareTextFromShareSheet("xiaohongshu", "小红书", "小红书") === null,
);
assert(
  "share sheet discards arbitrary xhs caption",
  shareTextFromShareSheet("xiaohongshu", "露营收纳技巧分享", "露营收纳技巧分享 https://xhslink.com/m/a") ===
    null,
);
assert(
  "share sheet discards x chrome",
  shareTextFromShareSheet("x", "X", "X https://x.com/a/status/1") === null,
);
assert(
  "share sheet keeps douyin text",
  shareTextFromShareSheet("douyin", "今天天气真好", "今天天气真好 https://v.douyin.com/a/") ===
    "今天天气真好",
);

const xShareJunk = { ...shareSheetJunk, platform: "x", share_text: "Twitter / X" };
assert("x share junk still needs enrich", needsXEnrichment(xShareJunk as never));
assert(
  "x after network enrich skips",
  !needsXEnrichment({ ...xShareJunk, meta_enriched_at: 1 } as never),
);
assert(
  "needsNetworkEnrichment covers both",
  needsNetworkEnrichment(shareSheetJunk as never) && needsNetworkEnrichment(xShareJunk as never),
);
assert(
  "enriched text not overwritten by longer junk",
  mergeShareTextPreferringEnrichment(
    "很长很长的错误分享面板文案用来骗长度比较",
    "真正的推文正文",
    true,
  ) === "真正的推文正文",
);
assert(
  "unenriched still merges by prefer",
  mergeShareTextPreferringEnrichment("更长的新文案内容在这里", "短", false) ===
    "更长的新文案内容在这里",
);

const fixture = readFileSync(
  resolve(__dirname, "../fixtures/xhs-note-snippet.html"),
  "utf8",
);
const meta = parseXiaohongshuHtml(fixture);
assert("xhs title not author", meta.title === "为什么李白的诗里，从未提及Tokens？");
assert("xhs author", meta.author === "Manto冲啊💫");
assert("xhs noteId", meta.noteId === "6a58a4d80000000001003e67");
assert("xhs share text", !!formatXiaohongshuShareText(meta));

// Video page: related notes in map + wrong DOM title — must pick URL noteId
const videoFixture = readFileSync(
  resolve(__dirname, "../fixtures/xhs-video-related-map.html"),
  "utf8",
);
const videoWrong = parseXiaohongshuHtml(videoFixture);
assert(
  "xhs video without trusted id refuses related map",
  videoWrong.title === null && videoWrong.body === null && videoWrong.noteId === null,
);
const videoRight = parseXiaohongshuHtml(
  videoFixture,
  "https://www.xiaohongshu.com/explore/6a58a4d80000000001003e67",
);
assert("xhs video picks note by url id", videoRight.noteId === "6a58a4d80000000001003e67");
assert("xhs video ignores related DOM title", videoRight.title === "真正的视频笔记文案在这里，讲的是露营收纳");
assert("xhs video author from state", videoRight.author === "真正的作者");
assert("xhs video note type", videoRight.noteType === "video");
assert(
  "xhs video share text correct",
  !!formatXiaohongshuShareText(videoRight)?.includes("露营收纳"),
);
assert(
  "xhs video without title saves body first",
  formatXiaohongshuShareText({
    title: null,
    author: "真正的作者",
    body: "正文第一行应该成为标题\n正文第二行",
    noteId: "6a58a4d80000000001003e67",
    noteType: "video",
  })?.startsWith("正文第一行应该成为标题") === true,
);

assert(
  "xhs related guess not credible",
  !isCredibleXiaohongshuMeta(videoWrong, null, "https://xhslink.com/m/abc"),
);
assert(
  "xhs url-matched meta is credible",
  isCredibleXiaohongshuMeta(
    videoRight,
    "6a58a4d80000000001003e67",
    "https://www.xiaohongshu.com/explore/6a58a4d80000000001003e67",
  ),
);

const mismatchedVideoHtml = `
<meta property="og:title" content="错误推荐标题 - 小红书" />
<meta property="og:description" content="错误推荐正文" />
<div class="fw500 title">错误DOM标题</div>
<span class="note-desc-text-opt">错误DOM正文</span>
<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"related":{"note":{"noteId":"related","type":"video","title":"错误推荐标题","desc":"错误推荐正文","user":{"nickname":"推荐作者"}}}}}};</script>
`;
const mismatchedVideo = parseXiaohongshuHtml(
  mismatchedVideoHtml,
  "https://www.xiaohongshu.com/explore/6a58a4d80000000001003e67",
  "6a58a4d80000000001003e67",
);
assert(
  "xhs expected id without matching state rejects unrelated og/dom",
  !isCredibleXiaohongshuMeta(
    mismatchedVideo,
    "6a58a4d80000000001003e67",
    "https://www.xiaohongshu.com/explore/6a58a4d80000000001003e67",
  ),
);

// Nested video stream JSON must not truncate INITIAL_STATE
const nestedVideo = readFileSync(
  resolve(__dirname, "../fixtures/xhs-video-nested-state.html"),
  "utf8",
);
const rawState = extractInitialStateRaw(nestedVideo);
assert("xhs nested state extracted", !!rawState && rawState.includes("masterUrl") && rawState.includes("deep"));
const nestedMeta = parseXiaohongshuHtml(
  nestedVideo,
  "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9",
);
assert("xhs nested video title", nestedMeta.title === "香妃蛋糕也太香了吧");
assert("xhs nested video type", nestedMeta.noteType === "video");
assert("xhs nested ignores DOM", nestedMeta.title !== "DOM里的错误推荐标题");

assert(
  "xhs candidates include explore+discovery",
  buildXiaohongshuCandidateUrls(
    "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9?xsec_token=TOKEN",
    "6411cf99000000001300b6d9",
  ).some((u) => u.includes("/discovery/item/") && u.includes("xsec_token=TOKEN")),
);

const openRow = {
  id: "1",
  ingest_id: null,
  platform: "xiaohongshu",
  original_url: "https://xhslink.com/m/abc",
  normalized_url: "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9",
  canonical_url: "https://www.xiaohongshu.com/discovery/item/6411cf99000000001300b6d9",
  external_id: "6411cf99000000001300b6d9",
  share_text: "t",
  comment: null,
  status: "unread",
  is_pinned: 0,
  open_count: 0,
  last_opened_at: null,
  watched_at: null,
  meta_enriched_at: 1,
  note_type: "video" as string | null,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
};
const openVideo = buildOpenUrlCandidates(openRow as never);
assert(
  "xhs video opens via video_feed scheme first",
  openVideo[0] === "xhsdiscover://video_feed/6411cf99000000001300b6d9",
);
assert(
  "xhs video does not prefer https first",
  !openVideo[0].startsWith("http"),
);

const openUnknown = buildOpenUrlCandidates({ ...openRow, note_type: null } as never);
assert(
  "xhs unknown type prefers video_feed not bare item",
  openUnknown[0] === "xhsdiscover://video_feed/6411cf99000000001300b6d9",
);
assert(
  "xhs unknown type does not put bare item first",
  openUnknown[0] !== "xhsdiscover://item/6411cf99000000001300b6d9",
);

// Commenter nickname must not win as title
const commentPolluted = `
<div class="reds-text fw500 title title-no-padding-top">真正的笔记标题</div>
<div class="reds-text author-username">笔记作者</div>
<span class="note-desc-text-opt">正文内容在这里</span>
<div class="comment-item"><div class="name">路人甲评论昵称</div></div>
<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"x":{"note":{"noteId":"abc123abc123abcd","title":"真正的笔记标题","desc":"正文内容在这里","user":{"nickname":"笔记作者"}}}}},"comments":{"list":[{"user":{"nickname":"路人甲评论昵称"}}]}};</script>
`;
const meta2 = parseXiaohongshuHtml(commentPolluted);
assert("xhs ignores commenter nickname as title", meta2.title === "真正的笔记标题");
assert("xhs author is note author", meta2.author === "笔记作者");

console.log("---");
console.log("douyinClean:", douyinClean);
console.log("xhs title:", meta.title);
console.log("xhs video title:", videoRight.title);
