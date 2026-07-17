/**
 * Smoke tests for multi-provider LLM chat client.
 * Run: npx --yes tsx scripts/test-llm-chat.ts
 */
import { isMediaParseError, llmChatCompletion } from "../src/ai/llmChat";
import { getLlmProvider } from "../src/ai/providers";
import { summarizeVideoContent } from "../src/ai/summarizeVideo";

function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) {
    process.exitCode = 1;
  }
}

async function main() {
  let openaiUrl = "";
  let openaiBody: Record<string, unknown> = {};
  const openaiFetch: typeof fetch = async (input, init) => {
    openaiUrl = String(input);
    openaiBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "openai-ok" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const openaiText = await llmChatCompletion({
    provider: getLlmProvider("deepseek"),
    apiKey: "sk-test",
    content: [{ type: "text", text: "hello" }],
    fetchImpl: openaiFetch,
  });
  assert("openai-compat returns text", openaiText === "openai-ok");
  assert("openai-compat hits chat/completions", openaiUrl.endsWith("/chat/completions"));
  assert("openai-compat model deepseek-chat", openaiBody.model === "deepseek-chat");

  let anthropicHeaders: Record<string, string> = {};
  let anthropicBody: Record<string, unknown> = {};
  const anthropicFetch: typeof fetch = async (_input, init) => {
    const headers = init?.headers as Record<string, string>;
    anthropicHeaders = headers;
    anthropicBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "claude-ok" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const claudeText = await llmChatCompletion({
    provider: getLlmProvider("claude"),
    apiKey: "sk-ant-test",
    content: [
      { type: "image_url", image_url: { url: "https://cdn.example.com/a.jpg" } },
      { type: "text", text: "summarize" },
    ],
    fetchImpl: anthropicFetch,
  });
  assert("anthropic returns text", claudeText === "claude-ok");
  assert("anthropic uses x-api-key", anthropicHeaders["x-api-key"] === "sk-ant-test");
  assert(
    "anthropic version header",
    anthropicHeaders["anthropic-version"] === "2023-06-01",
  );
  const messages = anthropicBody.messages as Array<{ content: Array<{ type: string }> }>;
  assert("anthropic maps image+text", messages?.[0]?.content?.length === 2);
  assert("anthropic image type", messages?.[0]?.content?.[0]?.type === "image");
  assert("anthropic text type", messages?.[0]?.content?.[1]?.type === "text");

  let zhipuBody: Record<string, unknown> = {};
  const zhipuText = await llmChatCompletion({
    provider: getLlmProvider("zhipu"),
    apiKey: "zk-test",
    content: [
      { type: "video_url", video_url: { url: "https://cdn.example.com/a.mp4" } },
      { type: "text", text: "看视频" },
    ],
    fetchImpl: async (_input, init) => {
      zhipuBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "video-ok" } }] }),
        { status: 200 },
      );
    },
  });
  assert("zhipu video call ok", zhipuText === "video-ok");
  const zhipuMessages = zhipuBody.messages as Array<{ content: Array<{ type: string }> }>;
  assert("zhipu sends video_url", zhipuMessages?.[0]?.content?.[0]?.type === "video_url");

  let saw401 = false;
  try {
    await llmChatCompletion({
      provider: getLlmProvider("openai"),
      apiKey: "bad",
      content: [{ type: "text", text: "x" }],
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "invalid key" } }), {
          status: 401,
        }),
    });
  } catch (error) {
    saw401 = error instanceof Error && /API Key|invalid key/i.test(error.message);
  }
  assert("maps 401 to readable error", saw401);

  assert("isMediaParseError true", isMediaParseError(new Error("图片输入格式/解析错误")));

  let call = 0;
  const cascade = await summarizeVideoContent({
    apiKey: "zk",
    provider: getLlmProvider("zhipu"),
    platform: "xiaohongshu",
    shareText: "标题",
    url: "https://www.xiaohongshu.com/explore/1",
    videoUrl: null,
    coverUrl: "https://cdn.example.com/cover.jpg",
    fetchImpl: async (input, init) => {
      const target = String(input);
      // Image download for base64 path
      if (target.includes("cdn.example.com/cover.jpg") && (!init || init.method === "GET")) {
        // tiny 1x1 png
        const png = Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
          0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
          0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
          0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
          0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]);
        return new Response(png, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      call += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ content?: Array<{ type?: string; image_url?: { url?: string } }> }>;
      };
      const part = body.messages?.[0]?.content?.[0];
      if (call === 1 && part?.type === "image_url" && !part.image_url?.url?.startsWith("data:")) {
        return new Response(
          JSON.stringify({ error: { message: "图片输入格式/解析错误" } }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "fallback-ok" } }] }),
        { status: 200 },
      );
    },
  });
  assert("cascade recovers from image parse error", cascade.summary === "fallback-ok");
  assert("cascade prefers cover when base64 works", cascade.basis === "cover");

  if (process.exitCode) {
    console.error("Some llm chat tests failed");
  } else {
    console.log("All llm chat tests passed");
  }
}

void main();
