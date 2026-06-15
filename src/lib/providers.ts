/**
 * Multi-Provider Router for Vercel AI SDK
 *
 * Supports: OpenAI, Anthropic, DeepSeek, Gemini, OpenRouter
 * Each provider is lazily initialized from environment variables.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// ─── Types ──────────────────────────────────────────────────────

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'gemini'
  | 'openrouter';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  requiresApiKey: boolean;
  envVar: string;
}

// ─── Provider Registry ──────────────────────────────────────────

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    envVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-haiku-4-5',
    requiresApiKey: true,
    envVar: 'ANTHROPIC_API_KEY',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
    envVar: 'DEEPSEEK_API_KEY',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    requiresApiKey: true,
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-4o-mini',
    requiresApiKey: true,
    envVar: 'OPENROUTER_API_KEY',
  },
};

export const DEFAULT_PROVIDER: ProviderId = 'deepseek';

// ─── Lazy Model Cache ──────────────────────────────────────────

const modelCache = new Map<string, LanguageModel>();

function cacheKey(p: ProviderId, m: string): string {
  return `${p}::${m}`;
}

// ─── Provider Factory ───────────────────────────────────────────

/**
 * Resolve a LanguageModel for the given provider and optional model ID.
 * Falls back to the provider's default model if none specified.
 *
 * DeepSeek and OpenRouter use the OpenAI-compatible protocol, so they
 * share the `createOpenAI` adapter with custom baseURLs.
 */
export function getModel(
  provider?: ProviderId,
  modelId?: string,
): LanguageModel {
  const p = provider ?? DEFAULT_PROVIDER;
  const info = PROVIDERS[p];
  const m = modelId ?? info.defaultModel;
  const key = cacheKey(p, m);

  const cached = modelCache.get(key);
  if (cached) return cached;

  let model: LanguageModel;

  switch (p) {
    case 'openai': {
      const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      model = client(m);
      break;
    }
    case 'anthropic': {
      const client = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      model = client(m);
      break;
    }
    case 'deepseek': {
      const client = createOpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com/v1',
      });
      model = client(m);
      break;
    }
    case 'gemini': {
      const client = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      model = client(m);
      break;
    }
    case 'openrouter': {
      const client = createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
      });
      model = client(m);
      break;
    }
    default:
      throw new Error(`Unknown provider: ${p}`);
  }

  modelCache.set(key, model);
  return model;
}

/**
 * List providers that have API keys configured in the environment.
 */
export function getAvailableProviders(): ProviderId[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).filter((id) => {
    const info = PROVIDERS[id];
    return !!process.env[info.envVar];
  });
}

/**
 * Check if a provider is available (API key is set).
 */
export function isProviderAvailable(provider: ProviderId): boolean {
  const info = PROVIDERS[provider];
  return !!process.env[info.envVar];
}
