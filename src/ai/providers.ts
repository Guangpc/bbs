export type LlmProtocol = "openai" | "anthropic";

export type LlmProviderId =
  | "zhipu"
  | "kimi"
  | "deepseek"
  | "openai"
  | "qwen"
  | "claude"
  | "gemini";

export interface LlmProvider {
  id: LlmProviderId;
  /** Short label for chips / buttons. */
  label: string;
  /** Default chat model id. */
  model: string;
  protocol: LlmProtocol;
  /**
   * OpenAI: base ending before `/chat/completions`.
   * Anthropic: full messages URL.
   */
  endpoint: string;
  supportsVision: boolean;
  /** Native video_url / video parts (Zhipu GLM-5V). */
  supportsVideo: boolean;
  /** Placeholder shown in the API key field. */
  keyHint: string;
  /** Extra OpenAI-compatible body fields (e.g. Zhipu thinking off). */
  extraBody?: Record<string, unknown>;
}

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "zhipu",
    label: "智谱 GLM",
    model: "glm-5v-turbo",
    protocol: "openai",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    supportsVision: true,
    supportsVideo: true,
    keyHint: "open.bigmodel.cn API Key",
    extraBody: { thinking: { type: "disabled" } },
  },
  // Kept for future switching / direct llmChat use; app summarize defaults to zhipu.
  {
    id: "kimi",
    label: "Kimi",
    model: "moonshot-v1-128k",
    protocol: "openai",
    endpoint: "https://api.moonshot.cn/v1",
    supportsVision: false,
    supportsVideo: false,
    keyHint: "api.moonshot.cn API Key",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    model: "deepseek-chat",
    protocol: "openai",
    endpoint: "https://api.deepseek.com/v1",
    supportsVision: false,
    supportsVideo: false,
    keyHint: "api.deepseek.com API Key",
  },
  {
    id: "openai",
    label: "GPT",
    model: "gpt-4o-mini",
    protocol: "openai",
    endpoint: "https://api.openai.com/v1",
    supportsVision: true,
    supportsVideo: false,
    keyHint: "platform.openai.com API Key",
  },
  {
    id: "qwen",
    label: "千问",
    model: "qwen-plus",
    protocol: "openai",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    supportsVision: false,
    supportsVideo: false,
    keyHint: "DashScope API Key",
  },
  {
    id: "claude",
    label: "Claude",
    model: "claude-sonnet-4-20250514",
    protocol: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    supportsVision: true,
    supportsVideo: false,
    keyHint: "console.anthropic.com API Key",
  },
  {
    id: "gemini",
    label: "Gemini",
    model: "gemini-2.0-flash",
    protocol: "openai",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    supportsVision: true,
    supportsVideo: false,
    keyHint: "aistudio.google.com API Key",
  },
];

export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "zhipu";

export function getLlmProvider(id: string | null | undefined): LlmProvider {
  const found = LLM_PROVIDERS.find((p) => p.id === id);
  return found ?? LLM_PROVIDERS.find((p) => p.id === DEFAULT_LLM_PROVIDER_ID)!;
}

export function isLlmProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDERS.some((p) => p.id === value);
}
