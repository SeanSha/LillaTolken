import type { AiStage, ProviderPreset } from '@kt/shared';
import type { ServerConfig } from '../config';
import type { RegisteredProvider } from './contracts';
import { cloudModelTag, createCloudProvider } from './cloud';
import { createLocalProvider } from './local';
import { createMockProvider, MOCK_MODEL_TAG } from './mock';

export type ProviderRegistry = Record<ProviderPreset, RegisteredProvider>;

/** One bundle per preset. The mock instance is long-lived so one-shot error markers work per task. */
export function createRegistry(config: ServerConfig, overrides: Partial<ProviderRegistry> = {}): ProviderRegistry {
  const hasKey = Boolean(config.openai.apiKey);
  const local = createLocalProvider(config.local);
  const cloudModels: Record<AiStage, string> = {
    ASR: config.openai.asrModel,
    INTERPRET: config.openai.llmModel,
    TRANSLATE: config.openai.llmModel,
    TTS: config.openai.ttsModel,
  };
  // Availability of `local` is a live view of the last engine probe (engines can be started later).
  let localInfo = local.describe();
  return {
    mock: { bundle: createMockProvider(), modelTag: MOCK_MODEL_TAG, available: true, providerName: 'mock', modelFor: () => 'mock' },
    cloud: {
      bundle: createCloudProvider(config.openai),
      modelTag: cloudModelTag(config.openai),
      available: hasKey,
      unavailableReason: hasKey ? undefined : 'OPENAI_API_KEY is not set on the server',
      providerName: 'openai',
      modelFor: (stage) => cloudModels[stage],
    },
    local: {
      bundle: local,
      get modelTag() {
        return localInfo.modelTag;
      },
      get available() {
        return localInfo.available;
      },
      get unavailableReason() {
        return localInfo.reason;
      },
      providerName: 'local',
      modelFor: (stage) => local.modelFor(stage),
      localHealth: async (force) => {
        const h = await local.refresh(force);
        localInfo = local.describe();
        return h;
      },
      refresh: async () => {
        await local.refresh();
        localInfo = local.describe();
      },
    },
    ...overrides,
  };
}
