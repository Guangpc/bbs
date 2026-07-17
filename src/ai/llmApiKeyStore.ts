import * as SecureStore from "expo-secure-store";

import {
  DEFAULT_LLM_PROVIDER_ID,
  getLlmProvider,
  isLlmProviderId,
  type LlmProviderId,
} from "./providers";

const SELECTED_PROVIDER_KEY = "llm_selected_provider";
const LEGACY_ZHIPU_KEY = "zhipu_api_key";

function apiKeyStoreKey(providerId: LlmProviderId): string {
  return `llm_api_key_${providerId}`;
}

async function secureGet(key: string): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(key);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string | null): Promise<void> {
  try {
    if (!value?.trim()) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    // expo-secure-store uses the iOS Keychain / Android Keystore (encrypted at rest).
    await SecureStore.setItemAsync(key, value.trim());
  } catch (error) {
    throw new Error(
      `无法保存 API Key：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getSelectedLlmProviderId(): Promise<LlmProviderId> {
  const stored = await secureGet(SELECTED_PROVIDER_KEY);
  if (stored && isLlmProviderId(stored)) {
    return stored;
  }
  return DEFAULT_LLM_PROVIDER_ID;
}

export async function setSelectedLlmProviderId(id: LlmProviderId): Promise<void> {
  await secureSet(SELECTED_PROVIDER_KEY, id);
}

/** Env fallback for local/dev only (never required). */
function envApiKey(providerId: LlmProviderId): string | null {
  const map: Partial<Record<LlmProviderId, string | undefined>> = {
    zhipu: process.env.EXPO_PUBLIC_ZHIPU_API_KEY,
    kimi: process.env.EXPO_PUBLIC_KIMI_API_KEY,
    deepseek: process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY,
    openai: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
    qwen: process.env.EXPO_PUBLIC_QWEN_API_KEY,
    claude: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY,
    gemini: process.env.EXPO_PUBLIC_GEMINI_API_KEY,
  };
  return map[providerId]?.trim() || null;
}

/**
 * Migrate legacy single Zhipu key into the per-provider SecureStore slot once.
 */
async function migrateLegacyZhipuKey(): Promise<void> {
  const modern = await secureGet(apiKeyStoreKey("zhipu"));
  if (modern) {
    return;
  }
  const legacy = await secureGet(LEGACY_ZHIPU_KEY);
  if (!legacy) {
    return;
  }
  await secureSet(apiKeyStoreKey("zhipu"), legacy);
  try {
    await SecureStore.deleteItemAsync(LEGACY_ZHIPU_KEY);
  } catch {
    // ignore
  }
}

export async function getLlmApiKey(providerId: LlmProviderId): Promise<string | null> {
  if (providerId === "zhipu") {
    await migrateLegacyZhipuKey();
  }
  const stored = await secureGet(apiKeyStoreKey(providerId));
  if (stored) {
    return stored;
  }
  return envApiKey(providerId);
}

export async function setLlmApiKey(
  providerId: LlmProviderId,
  key: string | null,
): Promise<void> {
  await secureSet(apiKeyStoreKey(providerId), key);
  if (providerId === "zhipu") {
    // Keep legacy slot cleared so we don't resurrect a stale key later.
    try {
      await SecureStore.deleteItemAsync(LEGACY_ZHIPU_KEY);
    } catch {
      // ignore
    }
  }
}

export async function hasLlmApiKey(providerId: LlmProviderId): Promise<boolean> {
  return !!(await getLlmApiKey(providerId));
}

/** Active provider + its key (or null if missing). */
export async function getActiveLlmCredentials(): Promise<{
  providerId: LlmProviderId;
  providerLabel: string;
  apiKey: string | null;
}> {
  const providerId = await getSelectedLlmProviderId();
  const provider = getLlmProvider(providerId);
  const apiKey = await getLlmApiKey(providerId);
  return {
    providerId,
    providerLabel: provider.label,
    apiKey,
  };
}

/** @deprecated Use getLlmApiKey('zhipu') */
export async function getZhipuApiKey(): Promise<string | null> {
  return getLlmApiKey("zhipu");
}

/** @deprecated Use setLlmApiKey('zhipu', key) */
export async function setZhipuApiKey(key: string): Promise<void> {
  await setLlmApiKey("zhipu", key);
}
