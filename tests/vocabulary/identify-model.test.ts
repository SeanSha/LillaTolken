import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../apps/server/src/config';
import { createVocabularyIdentifier } from '../../apps/server/src/vocabulary/identify';

const create = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class {
    responses = { create };
  },
}));

const image = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };
const body = {
  outcome: 'object',
  candidates: [{ zh: '苹果', sv: 'äpple', article: 'ett', translationUncertain: false, category: 'food' }],
};

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ output_text: JSON.stringify(body), usage: { input_tokens: 10, output_tokens: 4, input_tokens_details: { cached_tokens: 0 } } });
});

describe('cloud photo identification model', () => {
  it('calls gpt-6-luna without temperature', async () => {
    const cfg = loadConfig({ OPENAI_API_KEY: 'test-key', OPENAI_LLM_TEMPERATURE: '0' } as NodeJS.ProcessEnv).openai;
    expect(cfg.visionModel).toBe('gpt-6-luna');
    const result = await createVocabularyIdentifier(cfg).identify(image);
    expect(result.candidates[0]?.zh).toBe('苹果');
    const params = create.mock.calls[0]?.[0] as { model: string; temperature?: number; store: boolean };
    expect(params.model).toBe('gpt-6-luna');
    expect(params.store).toBe(false);
    expect(params).not.toHaveProperty('temperature');
  });

  it('still sends temperature for the previous vision model', async () => {
    const cfg = loadConfig({ OPENAI_API_KEY: 'test-key', OPENAI_LLM_TEMPERATURE: '0', OPENAI_VISION_MODEL: 'gpt-4.1-mini' } as NodeJS.ProcessEnv).openai;
    await createVocabularyIdentifier(cfg).identify(image);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: 'gpt-4.1-mini', temperature: 0 });
  });
});
