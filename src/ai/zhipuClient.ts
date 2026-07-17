/**
 * Thin wrapper kept for older imports. Prefer llmChat + providers.
 */
import { llmChatCompletion, type LlmContentPart } from "./llmChat";
import { getLlmProvider } from "./providers";

export type { LlmContentPart as ZhipuContentPart } from "./llmChat";
export { LlmApiError as ZhipuApiError } from "./llmChat";

export const ZHIPU_CHAT_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
export const ZHIPU_MODEL = "glm-5v-turbo";

export async function zhipuChatCompletion(options: {
  apiKey: string;
  content: LlmContentPart[];
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  return llmChatCompletion({
    provider: getLlmProvider("zhipu"),
    apiKey: options.apiKey,
    content: options.content,
    maxTokens: options.maxTokens,
    fetchImpl: options.fetchImpl,
  });
}
