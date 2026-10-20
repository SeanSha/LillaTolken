// Photo vocabulary identification. The image lives only in this request: it is not written to disk,
// not logged, and not stored on the OpenAI side (`store: false`). People are not labeled.
import OpenAI from 'openai';
import { AppError, type NormalizedUsage, type VocabularyIdentifyResponse } from '@kt/shared';
import type { ServerConfig } from '../config';
import { mapOpenAIError } from '../providers/cloud';
import { parseJson } from '../providers/dialogueParsing';
import type { VocabularyImage } from './image';
import { normalizeVocabularyModelOutput } from './normalize';

type OpenAIConfig = ServerConfig['openai'];

export const VOCABULARY_INSTRUCTIONS = `You label ONE photo for a preschool vocabulary card in Simplified Chinese and Swedish.

Decide the outcome:
- person: the main subject is a person, face, or body. Do this even if they are holding an object. Never name, describe, or guess who they are. candidates must be [].
- none: there is no concrete object. candidates must be [].
- uncertain: you cannot tell what the single main object is. candidates must be []. Do not guess a word.
- multiple: two or more concrete objects are similarly prominent. List each one you can name. Do not pick a winner. At most 4.
- object: one concrete object is clearly the subject. Exactly one candidate.

For each candidate:
- zh: the everyday Simplified Chinese noun a child would say.
- sv: the Swedish common noun in indefinite singular, WITHOUT the article.
- article: en, ett, or none when the noun has no en/ett article.
- translationUncertain: true when you are not sure of either word. If you are unsure of a word, do not invent it: use outcome uncertain and candidates [] instead of a placeholder.
- category: exactly one of animals, food, toys, clothing, home, school, nature, vehicles, other. Pick the preschool group for that object. Use other when it does not fit or you are unsure.

Do not read identity documents, do not describe bystanders, and do not include brand names as if they were the object.`;

export const VOCABULARY_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'candidates'],
  properties: {
    outcome: { type: 'string', enum: ['object', 'multiple', 'uncertain', 'person', 'none'] },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['zh', 'sv', 'article', 'translationUncertain', 'category'],
        properties: {
          zh: { type: 'string' },
          sv: { type: 'string' },
          article: { type: 'string', enum: ['en', 'ett', 'none'] },
          translationUncertain: { type: 'boolean' },
          category: { type: 'string', enum: ['animals', 'food', 'toys', 'clothing', 'home', 'school', 'nature', 'vehicles', 'other'] },
        },
      },
    },
  },
} as const;

export type VocabularyIdentifier = {
  identify(image: VocabularyImage, signal?: AbortSignal, report?: (usage: NormalizedUsage) => void): Promise<VocabularyIdentifyResponse>;
};

export function createVocabularyIdentifier(cfg: OpenAIConfig): VocabularyIdentifier {
  if (!cfg.apiKey) {
    return {
      async identify() {
        throw new AppError('NOT_CONFIGURED', 'OPENAI_API_KEY is not set on the server');
      },
    };
  }
  const client = new OpenAI({ apiKey: cfg.apiKey, maxRetries: cfg.maxRetries, timeout: cfg.timeoutMs });
  const timeoutMs = Math.max(cfg.timeoutMs, 45_000);
  return {
    async identify(image, signal, report) {
      try {
        const response = await client.responses.create(
          {
            model: cfg.visionModel,
            store: false,
            max_output_tokens: 500,
            instructions: VOCABULARY_INSTRUCTIONS,
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: 'Identify the main concrete object in this photo for a vocabulary card.' },
                  { type: 'input_image', image_url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`, detail: 'auto' },
                ],
              },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'vocabulary_card',
                strict: true,
                schema: VOCABULARY_RESPONSE_SCHEMA,
              },
            },
            ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
          },
          { signal, timeout: timeoutMs },
        );
        const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } }).usage;
        if (report && usage?.input_tokens !== undefined && usage.output_tokens !== undefined) {
          report({
            promptTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            ...(usage.input_tokens_details?.cached_tokens !== undefined ? { cachedPromptTokens: usage.input_tokens_details.cached_tokens } : {}),
          });
        }
        return normalizeVocabularyModelOutput(parseJson(response.output_text));
      } catch (error) {
        throw mapOpenAIError(error);
      }
    },
  };
}
