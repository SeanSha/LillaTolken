// Metadata-only evaluation events (docs/SYSTEM_DESIGN.md section 6).
// NEVER add fields that can carry audio, transcripts, translations, prompts or lastDelivered content.
import { z } from 'zod';
import { DirectionSchema, PresetSchema } from './schemas';

export const EVAL_EVENT_TYPES = [
  'TASK_STARTED',
  'RECORDING_STARTED',
  'RECORDING_STOPPED',
  'SEGMENT_TIMEOUT',
  'CONTINUE_SELECTED',
  'INPUT_FINISHED',
  'ASR_COMPLETED',
  'INTERPRETATION_READY', // extra: needed for interpretation latency
  'CLARIFICATION_PRESENTED',
  'CONFIRMATION_YES',
  'CONFIRMATION_NO',
  'TRANSLATION_READY',
  'TTS_READY', // extra: needed for TTS latency
  'PLAYBACK_COMPLETED',
  'TASK_COMPLETED',
  'TASK_CANCELLED',
  'SWITCH_REQUESTED',
  'SWITCH_YES',
  'SWITCH_NO',
  'ERROR',
  'SESSION_ENDED',
] as const;

export type EvalEventType = (typeof EVAL_EVENT_TYPES)[number];

export const EVAL_STAGES = ['asr', 'interpret', 'translate', 'tts'] as const;
export type EvalStage = (typeof EVAL_STAGES)[number];

/** Strict: any unknown key (e.g. an accidental `transcript`) is rejected by the backend. */
export const EvalEventSchema = z.strictObject({
  ts: z.string().max(40),
  sessionId: z.string().max(100),
  taskId: z.string().max(100).optional(),
  scenarioId: z.string().max(100).optional(),
  providerPreset: PresetSchema,
  modelTag: z.string().max(200).optional(),
  version: z.string().max(40),
  direction: DirectionSchema.optional(),
  eventType: z.enum(EVAL_EVENT_TYPES),
  elapsedMs: z.number().min(0).optional(),
  segmentDurationMs: z.number().min(0).optional(),
  clarificationCount: z.number().int().min(0).optional(),
  stage: z.enum(EVAL_STAGES).optional(),
  stageDurationMs: z.number().min(0).optional(),
  errorCategory: z.string().max(40).optional(),
  deliveryMode: z.enum(['audio', 'text_only']).optional(),
  // v1.2 additive metadata (still no content): per-segment identity and target playback time.
  segmentId: z.string().max(100).optional(),
  inputPurpose: z.enum(['INITIAL', 'CLARIFICATION', 'CORRECTION']).optional(),
  segmentIndex: z.number().int().min(0).max(1000).optional(),
  playbackMs: z.number().min(0).optional(),
});

export type EvalEvent = z.infer<typeof EvalEventSchema>;

export const EVAL_CSV_COLUMNS = [
  'ts',
  'sessionId',
  'taskId',
  'scenarioId',
  'providerPreset',
  'modelTag',
  'version',
  'direction',
  'eventType',
  'elapsedMs',
  'segmentDurationMs',
  'clarificationCount',
  'stage',
  'stageDurationMs',
  'errorCategory',
  'deliveryMode',
  'segmentId',
  'inputPurpose',
  'segmentIndex',
  'playbackMs',
] as const satisfies readonly (keyof EvalEvent)[];
