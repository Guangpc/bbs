import { getLlmProvider, type LlmProvider } from "./providers";

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

export interface LlmChatOptions {
  provider: LlmProvider;
  apiKey: string;
  content: LlmContentPart[];
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export class LlmApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmApiError";
  }
}

/** Zhipu (and similar) rejected remote image/video URL fetch or decode. */
export function isMediaParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /图片输入格式|解析错误|invalid[_\s-]?image|invalid[_\s-]?video|video.*format|image.*format|无法下载|download.*(image|video)|media.*(invalid|fail)/i.test(
    message,
  );
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string; type?: string };
}

function extractOpenAiText(data: OpenAiChatResponse): string {
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    return raw
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function extractAnthropicText(data: AnthropicResponse): string {
  if (!Array.isArray(data.content)) {
    return "";
  }
  return data.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("")
    .trim();
}

function mapHttpError(status: number, detail: string | undefined, label: string): LlmApiError {
  if (status === 401 || status === 403) {
    return new LlmApiError(detail || `${label} API Key 无效或权限不足`, status);
  }
  if (status === 429) {
    return new LlmApiError(detail || "调用过于频繁，请稍后再试", status);
  }
  return new LlmApiError(detail || `${label} 接口错误（HTTP ${status}）`, status);
}

async function chatOpenAiCompatible(options: LlmChatOptions): Promise<string> {
  const { provider, apiKey, content, maxTokens, fetchImpl = fetch } = options;
  const url = `${provider.endpoint.replace(/\/$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content }],
        max_tokens: maxTokens ?? 1024,
        ...(provider.extraBody ?? {}),
      }),
    });
  } catch (error) {
    throw new LlmApiError(
      `网络错误：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let data: OpenAiChatResponse = {};
  try {
    data = (await response.json()) as OpenAiChatResponse;
  } catch {
    // fall through
  }

  if (!response.ok) {
    throw mapHttpError(response.status, data.error?.message?.trim(), provider.label);
  }

  const text = extractOpenAiText(data);
  if (!text) {
    throw new LlmApiError("模型未返回总结内容");
  }
  return text;
}

async function chatAnthropic(options: LlmChatOptions): Promise<string> {
  const { provider, apiKey, content, maxTokens, fetchImpl = fetch } = options;

  const anthropicContent: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === "text") {
      anthropicContent.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      anthropicContent.push({
        type: "image",
        source: { type: "url", url: part.image_url.url },
      });
    } else {
      // Anthropic Messages has no video_url parity here — keep text-only fallback note.
      anthropicContent.push({
        type: "text",
        text: `（附视频链接，当前接口无法直接观看：${part.video_url.url}）`,
      });
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(provider.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens ?? 1024,
        messages: [{ role: "user", content: anthropicContent }],
      }),
    });
  } catch (error) {
    throw new LlmApiError(
      `网络错误：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let data: AnthropicResponse = {};
  try {
    data = (await response.json()) as AnthropicResponse;
  } catch {
    // fall through
  }

  if (!response.ok) {
    throw mapHttpError(response.status, data.error?.message?.trim(), provider.label);
  }

  const text = extractAnthropicText(data);
  if (!text) {
    throw new LlmApiError("模型未返回总结内容");
  }
  return text;
}

/** Unified chat call for the selected provider. */
export async function llmChatCompletion(options: LlmChatOptions): Promise<string> {
  if (options.provider.protocol === "anthropic") {
    return chatAnthropic(options);
  }
  return chatOpenAiCompatible(options);
}

/** Convenience: resolve provider by id. */
export async function llmChatByProviderId(options: {
  providerId: string;
  apiKey: string;
  content: LlmContentPart[];
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  return llmChatCompletion({
    provider: getLlmProvider(options.providerId),
    apiKey: options.apiKey,
    content: options.content,
    maxTokens: options.maxTokens,
    fetchImpl: options.fetchImpl,
  });
}
