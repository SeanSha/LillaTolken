import { z } from 'zod';
import { PAYLOAD_LIMITS } from './types';

const text = z.string().max(PAYLOAD_LIMITS.maxTextChars);

export const DirectionSchema = z.enum(['ZH_TO_SV', 'SV_TO_ZH']);
export const LanguageSchema = z.enum(['zh', 'sv']);
export const PresetSchema = z.enum(['mock', 'cloud', 'local']);

export const DialogueInputSchema = z.object({
  purpose: z.enum(['INITIAL', 'CLARIFICATION', 'CORRECTION']),
  textParts: z.array(text).min(1).max(PAYLOAD_LIMITS.maxTextParts),
  inReplyTo: text.optional(),
});

export const LastDeliveredSchema = z.object({
  taskId: z.string().max(100),
  direction: DirectionSchema,
  source: text,
  translation: text,
});

export const InterpretRequestSchema = z.object({
  dialogueInputs: z.array(DialogueInputSchema).min(1).max(20),
  remainingClarifications: z.number().int().min(0).max(10),
  previousDelivered: LastDeliveredSchema.nullish(),
});

export const TranslateRequestSchema = z.object({
  text: text.min(1),
  direction: DirectionSchema,
  previousDelivered: LastDeliveredSchema.nullish(),
});

export const TtsRequestSchema = z.object({
  text: text.min(1),
  language: LanguageSchema,
});

/** Validated structure of any interpretation, regardless of provider. */
export const InterpretationResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ASK_CLARIFICATION'),
    questionZh: z.string().trim().min(1).max(200),
    reasonCode: z.string().max(100),
  }),
  z.object({
    kind: z.literal('PROPOSE_MEANING'),
    meaningZh: z.string().trim().min(1).max(500),
  }),
  z.object({
    kind: z.literal('UNRESOLVED'),
    reasonCode: z.string().max(100),
  }),
]);

export const TranslateResponseSchema = z.object({ translation: z.string().trim().min(1).max(PAYLOAD_LIMITS.maxTextChars) });
export const AsrResponseSchema = z.object({ text: z.string().max(PAYLOAD_LIMITS.maxTextChars) });
