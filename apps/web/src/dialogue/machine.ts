// ONE dialogue Statechart for every provider preset (docs/SYSTEM_DESIGN.md section 4).
// The machine owns all decisions: counters, mandatory confirmation, switching, memory.
// Providers only return structured proposals / translations that are validated first.
import { assign, fromPromise, setup } from 'xstate';
import {
  AppError,
  InterpretationResultSchema,
  LIMITS,
  languageOfSpeaker,
  targetLanguage,
  toAppError,
  type AudioData,
  type DeliveryMode,
  type EvalEventType,
  type EvalStage,
  type InterpretationResult,
  type Language,
  type LastDelivered,
  type ResponseType,
} from '@kt/shared';
import type {
  DialogueDeps,
  DialogueEvent,
  Direction,
  InputPurpose,
  LogFields,
  MachineContext,
  PlaybackSlot,
  PromptId,
  ProviderPreset,
  SafeReturnKey,
  Task,
} from './types';
import { confirmationPrompt } from './text';

type Stamped = { taskId: string; requestId: string; durationMs: number };
type TranscribeOut = Stamped & { texts: string[] };
type InterpretOut = Stamped & { result: InterpretationResult };
type TranslateOut = Stamped & { text: string };
type SynthOut = Stamped & { audio: AudioData; slot: PlaybackSlot };

type TranscribeIn = { taskId: string; requestId: string; preset: ProviderPreset; language: Language };
type InterpretIn = {
  taskId: string;
  requestId: string;
  preset: ProviderPreset;
  dialogueInputs: Task['dialogueInputs'];
  remainingClarifications: number;
  previousDelivered: LastDelivered | null;
};
type TranslateIn = {
  taskId: string;
  requestId: string;
  preset: ProviderPreset;
  text: string | null;
  direction: Direction;
  previousDelivered: LastDelivered | null;
};
type SynthIn = {
  taskId: string;
  requestId: string;
  preset: ProviderPreset;
  text: string;
  language: Language;
  slot: PlaybackSlot;
};

export type DialogueMachineInput = { sessionId?: string; preset?: ProviderPreset } | undefined;

export function createDialogueMachine(deps: DialogueDeps) {
  // ---------- helpers (pure apart from deps) ----------
  const needTask = (context: MachineContext): Task => {
    if (!context.task) throw new Error('No active task');
    return context.task;
  };
  const patchTask = (context: MachineContext, patch: Partial<Task>): { task: Task } => ({
    task: { ...needTask(context), ...patch },
  });

  const emit = (context: MachineContext, eventType: EvalEventType, extra: Partial<LogFields> = {}) => {
    const task = context.task;
    deps.log({
      sessionId: context.sessionId,
      providerPreset: task?.preset ?? context.preset,
      eventType,
      ...(task
        ? {
            taskId: task.id,
            direction: task.direction,
            elapsedMs: Math.max(0, deps.now() - task.startedAt),
            clarificationCount: task.clarificationCount,
          }
        : {}),
      ...extra,
    });
  };

  const emitStage = (context: MachineContext, eventType: EvalEventType, stage: EvalStage, durationMs: number) =>
    emit(context, eventType, { stage, stageDurationMs: durationMs });

  // Response latency uses deps.monoNow only. Wall-clock deps.now() stays on the existing events.
  const markInputFinished = () => {
    if (deps.responses && deps.monoNow) deps.responses.noteInputFinished(deps.monoNow());
  };
  const markConfirmationTap = () => {
    if (deps.responses && deps.monoNow) deps.responses.noteConfirmationTap(deps.monoNow());
  };
  const armResponse = (responseType: ResponseType) => deps.responses?.arm(responseType);

  const speakerLanguage = (context: MachineContext): Language =>
    context.task ? languageOfSpeaker(context.task.direction) : 'zh';

  const beginTask = (ctx: MachineContext, direction: Direction): Partial<MachineContext> => {
    const task: Task = {
      id: deps.newId(),
      direction,
      preset: ctx.preset, // frozen for the lifetime of the task
      inputPurpose: 'INITIAL',
      segmentInfo: [],
      pendingSegments: 0,
      dialogueInputs: [],
      proposedMeaning: null,
      currentQuestion: null,
      confirmedMeaning: null,
      sourceText: null,
      translatedText: null,
      clarificationCount: 0,
      correctionCount: 0,
      asrRetryCount: 0,
      startedAt: deps.now(),
    };
    return {
      task,
      pendingDirection: null,
      safeReturnState: null,
      activeRequestId: null,
      error: null,
      fallbackReason: null,
      audioStatus: 'none',
      segmentStartedAt: null,
    };
  };

  const beginInput = (context: MachineContext, purpose: InputPurpose) =>
    patchTask(context, { inputPurpose: purpose, pendingSegments: 0 });

  const isStale = (context: MachineContext, out: Stamped): boolean =>
    out.requestId !== context.activeRequestId || out.taskId !== context.task?.id;

  const deliveredMemory = (context: MachineContext): LastDelivered => {
    const task = needTask(context);
    return {
      taskId: task.id,
      direction: task.direction,
      source: (task.direction === 'ZH_TO_SV' ? task.confirmedMeaning : task.sourceText) ?? '',
      translation: task.translatedText ?? '',
    };
  };

  const completeDelivery = (context: MachineContext, mode: DeliveryMode) => {
    if (mode === 'audio') emit(context, 'PLAYBACK_COMPLETED', { deliveryMode: mode, playbackMs: deps.lastPlaybackMs?.() });
    if (mode === 'text_only') deps.responses?.abandonUnplayed();
    emit(context, 'TASK_COMPLETED', { deliveryMode: mode });
  };

  const stamp = (input: { taskId: string; requestId: string }, started: number): Stamped => ({
    taskId: input.taskId,
    requestId: input.requestId,
    durationMs: Math.max(0, deps.now() - started),
  });

  const errorOf = (event: { error: unknown }, fallback: Parameters<typeof toAppError>[1]) =>
    toAppError(event.error, fallback).category;

  // ---------- machine ----------
  const dialogueSetup = setup({
    types: {
      context: {} as MachineContext,
      events: {} as DialogueEvent,
      input: {} as DialogueMachineInput,
    },
    delays: {
      segmentTimeout: LIMITS.segmentSeconds * 1000,
    },
    actors: {
      speakPrompt: fromPromise<void, { id: PromptId; language: Language }>(async ({ input }) => {
        // Wake the microphone just before the 'start' prompt ends (not during it: opening the mic
        // switches the phone's audio session and would clip the start of the prompt).
        await deps.speakPrompt(input.id, input.language, {
          onNearEnd: input.id === 'start' ? () => void deps.recorder.prepare?.().catch(() => undefined) : undefined,
        });
      }),
      startRecording: fromPromise<void>(async () => {
        await deps.recorder.start();
      }),
      stopRecording: fromPromise<AudioData>(async () => deps.recorder.stop()),
      transcribe: fromPromise<TranscribeOut, TranscribeIn>(async ({ input, signal }) => {
        const started = deps.now();
        const segments = deps.audioStore.getSegments(input.taskId);
        if (segments.length === 0) throw new AppError('RECORDER', 'no audio segments to transcribe');
        const { asr } = deps.providers(input.preset);
        const texts: string[] = [];
        // Ordered, one segment at a time: boundaries are preserved, no words invented between fragments.
        for (const audio of segments) {
          const text = (await asr.transcribe(audio, input.language, { taskId: input.taskId, requestId: input.requestId, signal })).trim();
          if (text) texts.push(text);
        }
        if (texts.length === 0) throw new AppError('ASR_EMPTY');
        return { ...stamp(input, started), texts };
      }),
      interpret: fromPromise<InterpretOut, InterpretIn>(async ({ input, signal }) => {
        const started = deps.now();
        const { dialogue } = deps.providers(input.preset);
        const raw = await dialogue.interpretChinese(
          {
            dialogueInputs: input.dialogueInputs,
            remainingClarifications: input.remainingClarifications,
            previousDelivered: input.previousDelivered,
          },
          { taskId: input.taskId, requestId: input.requestId, signal },
        );
        // Never trust a provider: validate structure before it can reach the machine.
        const parsed = InterpretationResultSchema.safeParse(raw);
        if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'interpretation failed validation');
        return { ...stamp(input, started), result: parsed.data };
      }),
      translate: fromPromise<TranslateOut, TranslateIn>(async ({ input, signal }) => {
        const started = deps.now();
        if (!input.text) throw new AppError('BAD_REQUEST', 'nothing to translate');
        const { dialogue } = deps.providers(input.preset);
        const text = (
          await dialogue.translate(
            { text: input.text, direction: input.direction, previousDelivered: input.previousDelivered },
            { taskId: input.taskId, requestId: input.requestId, signal },
          )
        ).trim();
        if (!text) throw new AppError('INVALID_MODEL_OUTPUT', 'empty translation');
        return { ...stamp(input, started), text };
      }),
      synthesize: fromPromise<SynthOut, SynthIn>(async ({ input, signal }) => {
        const started = deps.now();
        const { tts } = deps.providers(input.preset);
        const audio = await tts.synthesize(input.text, input.language, {
          taskId: input.taskId,
          requestId: input.requestId,
          signal,
        });
        return { ...stamp(input, started), audio, slot: input.slot };
      }),
    },
    guards: {
      switchAllowed: ({ context, event }) =>
        event.type === 'SWITCH_REQUESTED' && context.task !== null && event.direction !== context.task.direction,
    },
    actions: {
      newRequestId: assign({ activeRequestId: () => deps.newId() }),
      requestSwitch: assign({
        pendingDirection: ({ event }) => (event.type === 'SWITCH_REQUESTED' ? event.direction : null),
        safeReturnState: (_, params: { key: SafeReturnKey }) => params.key,
        activeRequestId: () => null,
      }),
      /** Drop a live/half-started recording (idempotent). */
      discardLiveRecording: () => {
        deps.recorder.cancel();
        deps.stopSpeaking();
      },
      cleanupMedia: () => {
        deps.recorder.cancel();
        deps.audioStore.clearAll();
        deps.stopPlayback();
        deps.stopSpeaking();
      },
      stopSpeaking: () => deps.stopSpeaking(),
      stopPlayback: () => deps.stopPlayback(),
      speak: ({ context }, params: { id: PromptId }) => {
        deps.speakPrompt(params.id, speakerLanguage(context)).catch(() => undefined);
      },
      logSwitchNo: ({ context }) => emit(context, 'SWITCH_NO'),
      clearSwitchRequest: assign({ pendingDirection: () => null, safeReturnState: () => null }),
      logCancelled: ({ context }) => {
        deps.responses?.reset();
        if (context.task) emit(context, 'TASK_CANCELLED');
      },
      logTaskStarted: ({ context }) => {
        deps.responses?.reset();
        emit(context, 'TASK_STARTED');
        if (context.task) {
          deps.onTaskStarted?.({ id: context.task.id, direction: context.task.direction, preset: context.task.preset });
        }
      },
    },
  });

  const spokenPromptInput = (id: PromptId) => ({ context }: { context: MachineContext }) => ({
    id,
    language: speakerLanguage(context),
  });

  /** Request a direction switch from a task state; `key` is the safe checkpoint to return to on No. */
  const sw = (key: SafeReturnKey) => ({
    guard: 'switchAllowed' as const,
    target: '#confirmingSwitch',
    actions: [{ type: 'requestSwitch' as const, params: { key } }, 'discardLiveRecording' as const],
  });

  /** What gets spoken: the clarification question, the confirmation sentence, or the final translation. */
  const synthInput =
    (what: 'question' | 'confirmation' | 'result') =>
    ({ context }: { context: MachineContext }): SynthIn => {
      const task = needTask(context);
      const text =
        what === 'result'
          ? (task.translatedText ?? '')
          : what === 'confirmation'
            ? confirmationPrompt(task.proposedMeaning ?? '')
            : (task.currentQuestion ?? '');
      return {
        taskId: task.id,
        requestId: context.activeRequestId ?? '',
        preset: task.preset,
        text,
        language: what === 'result' ? targetLanguage(task.direction) : 'zh',
        slot: what === 'result' ? 'result' : 'prompt',
      };
    };

  return dialogueSetup.createMachine({
    id: 'dialogue',
    context: ({ input }) => ({
      sessionId: input?.sessionId ?? deps.newId(),
      preset: input?.preset ?? 'mock',
      task: null,
      lastDelivered: null,
      pendingDirection: null,
      safeReturnState: null,
      activeRequestId: null,
      error: null,
      fallbackReason: null,
      audioStatus: 'none',
      segmentStartedAt: null,
    }),
    initial: 'idle',
    on: {
      // Volatile content and memory are cleared; metadata events remain in the evaluation log.
      END_SESSION: {
        target: '#idle',
        reenter: true,
        actions: [
          ({ context }) => emit(context, 'SESSION_ENDED'),
          assign(({ context }) => ({
            sessionId: deps.newId(),
            lastDelivered: null,
            preset: context.preset,
          })),
        ],
      },
    },
    states: {
      // ------------------------------------------------------------------ IDLE
      idle: {
        id: 'idle',
        entry: [
          'cleanupMedia',
          assign({
            task: () => null,
            pendingDirection: () => null,
            safeReturnState: () => null,
            activeRequestId: () => null,
            error: () => null,
            fallbackReason: () => null,
            audioStatus: () => 'none' as const,
            segmentStartedAt: () => null,
          }),
        ],
        on: {
          START_TASK: {
            target: '#recording',
            actions: [assign(({ context, event }) => beginTask(context, event.direction)), 'logTaskStarted'],
          },
          // Nothing to cancel while idle: a "switch" is simply starting that direction.
          SWITCH_REQUESTED: {
            target: '#recording',
            actions: [assign(({ context, event }) => beginTask(context, event.direction)), 'logTaskStarted'],
          },
          // Provider presets can change ONLY while idle (T13).
          SET_PRESET: { actions: assign({ preset: ({ event }) => event.preset }) },
        },
      },

      // ------------------------------------------------------------------ TASK (any unfinished work)
      task: {
        id: 'task',
        initial: 'recording',
        on: {
          CANCEL: { target: '#idle', actions: 'logCancelled' },
        },
        states: {
          // ---- Recording one segment (INITIAL, CLARIFICATION and CORRECTION share this UI) ----
          recording: {
            id: 'recording',
            initial: 'prompting',
            on: { SWITCH_REQUESTED: sw('recording') },
            states: {
              prompting: {
                invoke: {
                  src: 'speakPrompt',
                  input: spokenPromptInput('start'),
                  onDone: 'starting',
                  onError: 'starting',
                },
                exit: 'stopSpeaking',
                on: { SKIP_PROMPT: 'starting' },
              },
              starting: {
                id: 'recStarting',
                invoke: {
                  src: 'startRecording',
                  onDone: {
                    target: 'listening',
                    actions: [
                      assign({ segmentStartedAt: () => deps.now() }),
                      ({ context }) => emit(context, 'RECORDING_STARTED'),
                    ],
                  },
                  onError: {
                    target: '#recoverableError',
                    actions: assign({
                      error: ({ event }) => ({ stage: 'recorder' as const, category: errorOf(event, 'RECORDER') }),
                    }),
                  },
                },
              },
              listening: {
                // Pauses/silence never end a segment; only Stop or this 30 s countdown does.
                after: {
                  segmentTimeout: {
                    target: 'finalizing',
                    actions: ({ context }) => emit(context, 'SEGMENT_TIMEOUT'),
                  },
                },
                on: {
                  STOP_SEGMENT: 'finalizing',
                  SEGMENT_TIMEOUT: {
                    target: 'finalizing',
                    actions: ({ context }) => emit(context, 'SEGMENT_TIMEOUT'),
                  },
                },
              },
              finalizing: {
                invoke: {
                  src: 'stopRecording',
                  onDone: {
                    target: '#segmentDecision',
                    actions: [
                      ({ context, event }) => deps.audioStore.addSegment(needTask(context).id, event.output),
                      assign(({ context, event }) => {
                        const task = needTask(context);
                        const durationMs =
                          event.output.durationMs ??
                          (context.segmentStartedAt !== null ? Math.max(0, deps.now() - context.segmentStartedAt) : 0);
                        return {
                          segmentStartedAt: null,
                          task: {
                            ...task,
                            pendingSegments: task.pendingSegments + 1,
                            segmentInfo: [...task.segmentInfo, { id: deps.newId(), durationMs, purpose: task.inputPurpose }],
                          },
                        };
                      }),
                      ({ context }) =>
                        emit(context, 'RECORDING_STOPPED', {
                          segmentDurationMs: context.task?.segmentInfo.at(-1)?.durationMs,
                          segmentId: context.task?.segmentInfo.at(-1)?.id,
                          inputPurpose: context.task?.segmentInfo.at(-1)?.purpose,
                          segmentIndex: Math.max(0, (context.task?.segmentInfo.length ?? 1) - 1),
                        }),
                    ],
                  },
                  onError: {
                    target: '#recoverableError',
                    actions: assign({
                      error: ({ event }) => ({ stage: 'recorder' as const, category: errorOf(event, 'RECORDER') }),
                    }),
                  },
                },
              },
            },
          },

          // ---- Continue or Finished? ----
          segmentDecision: {
            id: 'segmentDecision',
            entry: { type: 'speak', params: { id: 'continue' } },
            exit: 'stopSpeaking',
            on: {
              CONTINUE_SPEAKING: { target: '#recStarting', actions: ({ context }) => emit(context, 'CONTINUE_SELECTED') },
              FINISH_INPUT: {
                target: '#transcribing',
                actions: ({ context }) => {
                  emit(context, 'INPUT_FINISHED');
                  markInputFinished();
                },
              },
              SWITCH_REQUESTED: sw('segmentDecision'),
            },
          },

          // ---- ASR over all segments of the current input, in order ----
          transcribing: {
            id: 'transcribing',
            entry: 'newRequestId',
            on: { SWITCH_REQUESTED: sw('transcribing') },
            invoke: {
              src: 'transcribe',
              input: ({ context }): TranscribeIn => {
                const task = needTask(context);
                return {
                  taskId: task.id,
                  requestId: context.activeRequestId ?? '',
                  preset: task.preset,
                  language: languageOfSpeaker(task.direction),
                };
              },
              onDone: [
                { guard: ({ context, event }) => isStale(context, event.output) }, // ignore outdated completion
                {
                  guard: ({ context }) => context.task?.direction === 'SV_TO_ZH',
                  target: '#translating',
                  actions: [
                    ({ context }) => deps.audioStore.clearSegments(needTask(context).id),
                    assign(({ context, event }) => {
                      const task = needTask(context);
                      return {
                        task: {
                          ...task,
                          pendingSegments: 0,
                          sourceText: event.output.texts.join(' '),
                          dialogueInputs: [...task.dialogueInputs, { purpose: task.inputPurpose, textParts: event.output.texts }],
                        },
                      };
                    }),
                    ({ context, event }) => emitStage(context, 'ASR_COMPLETED', 'asr', event.output.durationMs),
                  ],
                },
                {
                  target: '#interpreting',
                  actions: [
                    ({ context }) => deps.audioStore.clearSegments(needTask(context).id),
                    assign(({ context, event }) => {
                      const task = needTask(context);
                      return {
                        task: {
                          ...task,
                          pendingSegments: 0,
                          // A clarification answer is part of the same task, tagged with its question.
                          currentQuestion: task.inputPurpose === 'CLARIFICATION' ? null : task.currentQuestion,
                          dialogueInputs: [
                            ...task.dialogueInputs,
                            {
                              purpose: task.inputPurpose,
                              textParts: event.output.texts,
                              ...(task.inputPurpose === 'CLARIFICATION' && task.currentQuestion
                                ? { inReplyTo: task.currentQuestion }
                                : {}),
                            },
                          ],
                        },
                      };
                    }),
                    ({ context, event }) => emitStage(context, 'ASR_COMPLETED', 'asr', event.output.durationMs),
                  ],
                },
              ],
              onError: [
                {
                  // Empty recognition: discard audio and ask for a re-record (bounded).
                  guard: ({ context, event }) =>
                    errorOf(event, 'UNKNOWN') === 'ASR_EMPTY' && needTask(context).asrRetryCount < LIMITS.asrRetries,
                  target: '#asrEmpty',
                  actions: [
                    ({ context }) => deps.audioStore.clearSegments(needTask(context).id),
                    assign(({ context }) => patchTask(context, { asrRetryCount: needTask(context).asrRetryCount + 1, pendingSegments: 0 })),
                    ({ context }) => emit(context, 'ERROR', { stage: 'asr', errorCategory: 'ASR_EMPTY' }),
                  ],
                },
                {
                  guard: ({ event }) => errorOf(event, 'UNKNOWN') === 'ASR_EMPTY',
                  target: '#fallback',
                  actions: [
                    assign({ fallbackReason: () => 'ASR_EMPTY_LIMIT' as const }),
                    ({ context }) => emit(context, 'ERROR', { stage: 'asr', errorCategory: 'ASR_EMPTY' }),
                  ],
                },
                {
                  target: '#recoverableError',
                  actions: assign({
                    error: ({ event }) => ({ stage: 'asr' as const, category: errorOf(event, 'UNKNOWN') }),
                  }),
                },
              ],
            },
          },

          // ---- Empty ASR: re-record (counts against asrRetries) ----
          asrEmpty: {
            id: 'asrEmpty',
            entry: { type: 'speak', params: { id: 'asrEmpty' } },
            exit: 'stopSpeaking',
            on: {
              RETRY: '#recording',
              SWITCH_REQUESTED: sw('asrEmpty'),
            },
          },

          // ---- Chinese -> Swedish: interpret meaning ----
          interpreting: {
            id: 'interpreting',
            entry: 'newRequestId',
            on: { SWITCH_REQUESTED: sw('interpreting') },
            invoke: {
              src: 'interpret',
              input: ({ context }): InterpretIn => {
                const task = needTask(context);
                return {
                  taskId: task.id,
                  requestId: context.activeRequestId ?? '',
                  preset: task.preset,
                  dialogueInputs: task.dialogueInputs,
                  remainingClarifications: Math.max(0, LIMITS.semanticClarifications - task.clarificationCount),
                  previousDelivered: context.lastDelivered,
                };
              },
              onDone: [
                { guard: ({ context, event }) => isStale(context, event.output) },
                {
                  // XState (not the model) decides whether a question is allowed. Never question #4.
                  guard: ({ context, event }) =>
                    event.output.result.kind === 'ASK_CLARIFICATION' &&
                    needTask(context).clarificationCount < LIMITS.semanticClarifications,
                  target: '#clarifying',
                  actions: [
                    assign(({ context, event }) =>
                      patchTask(context, {
                        currentQuestion: event.output.result.kind === 'ASK_CLARIFICATION' ? event.output.result.questionZh : null,
                        clarificationCount: needTask(context).clarificationCount + 1,
                      }),
                    ),
                    ({ context, event }) => emitStage(context, 'INTERPRETATION_READY', 'interpret', event.output.durationMs),
                    ({ context }) => emit(context, 'CLARIFICATION_PRESENTED'),
                    () => armResponse('clarification'),
                  ],
                },
                {
                  guard: ({ event }) => event.output.result.kind === 'ASK_CLARIFICATION',
                  target: '#fallback',
                  actions: [
                    assign({ fallbackReason: () => 'CLARIFICATION_LIMIT' as const }),
                    ({ context, event }) => emitStage(context, 'INTERPRETATION_READY', 'interpret', event.output.durationMs),
                  ],
                },
                {
                  guard: ({ event }) => event.output.result.kind === 'PROPOSE_MEANING',
                  target: '#confirming',
                  actions: [
                    assign(({ context, event }) =>
                      patchTask(context, {
                        proposedMeaning: event.output.result.kind === 'PROPOSE_MEANING' ? event.output.result.meaningZh : null,
                        currentQuestion: null,
                      }),
                    ),
                    ({ context, event }) => emitStage(context, 'INTERPRETATION_READY', 'interpret', event.output.durationMs),
                    () => armResponse('confirmation'),
                  ],
                },
                {
                  target: '#fallback',
                  actions: [
                    assign({ fallbackReason: () => 'UNRESOLVED' as const }),
                    ({ context, event }) => emitStage(context, 'INTERPRETATION_READY', 'interpret', event.output.durationMs),
                  ],
                },
              ],
              onError: {
                target: '#recoverableError',
                actions: assign({
                  error: ({ event }) => ({ stage: 'interpret' as const, category: errorOf(event, 'UNKNOWN') }),
                }),
              },
            },
          },

          // ---- Ask ONE short semantic question (counted when presented) ----
          clarifying: {
            id: 'clarifying',
            initial: 'synthesizing',
            exit: ['stopPlayback'],
            on: { SWITCH_REQUESTED: sw('clarifying') },
            states: {
              synthesizing: {
                entry: [
                  'newRequestId',
                  'stopPlayback',
                  () => deps.audioStore.clearPlayback('prompt'),
                  assign({ audioStatus: () => 'none' as const }),
                ],
                invoke: {
                  src: 'synthesize',
                  input: synthInput('question'),
                  onDone: [
                    { guard: ({ context, event }) => isStale(context, event.output) },
                    {
                      target: 'asking',
                      actions: [
                        ({ event }) => deps.audioStore.setPlayback(event.output.slot, event.output.audio),
                        assign({ audioStatus: () => 'ready' as const }),
                        ({ context, event }) => emitStage(context, 'TTS_READY', 'tts', event.output.durationMs),
                      ],
                    },
                  ],
                  // A failed spoken question is not fatal: the text stays readable for the adult.
                  onError: {
                    target: 'asking',
                    actions: [
                      assign({ audioStatus: () => 'failed' as const }),
                      ({ context, event }) => emit(context, 'ERROR', { stage: 'tts', errorCategory: errorOf(event, 'TTS') }),
                    ],
                  },
                },
              },
              asking: {
                on: {
                  START_ANSWER: {
                    target: '#recording',
                    actions: assign(({ context }) => beginInput(context, 'CLARIFICATION')),
                  },
                  RETRY: { guard: ({ context }) => context.audioStatus === 'failed', target: 'synthesizing' },
                },
              },
            },
          },

          // ---- ALWAYS confirm the latest proposed Chinese meaning ----
          confirming: {
            id: 'confirming',
            initial: 'synthesizing',
            exit: ['stopPlayback'],
            on: { SWITCH_REQUESTED: sw('confirming') },
            states: {
              synthesizing: {
                entry: [
                  'newRequestId',
                  'stopPlayback',
                  () => deps.audioStore.clearPlayback('prompt'),
                  assign({ audioStatus: () => 'none' as const }),
                ],
                invoke: {
                  src: 'synthesize',
                  input: synthInput('confirmation'),
                  onDone: [
                    { guard: ({ context, event }) => isStale(context, event.output) },
                    {
                      target: 'asking',
                      actions: [
                        ({ event }) => deps.audioStore.setPlayback(event.output.slot, event.output.audio),
                        assign({ audioStatus: () => 'ready' as const }),
                        ({ context, event }) => emitStage(context, 'TTS_READY', 'tts', event.output.durationMs),
                      ],
                    },
                  ],
                  onError: {
                    target: 'asking',
                    actions: [
                      assign({ audioStatus: () => 'failed' as const }),
                      ({ context, event }) => emit(context, 'ERROR', { stage: 'tts', errorCategory: errorOf(event, 'TTS') }),
                    ],
                  },
                },
              },
              asking: {
                on: {
                  CONFIRM_YES: {
                    guard: ({ context }) => context.task?.proposedMeaning != null,
                    target: '#translating',
                    actions: [
                      assign(({ context }) => patchTask(context, { confirmedMeaning: needTask(context).proposedMeaning })),
                      ({ context }) => {
                        emit(context, 'CONFIRMATION_YES');
                        markConfirmationTap();
                      },
                    ],
                  },
                  CONFIRM_NO: [
                    {
                      // The rejected meaning is invalidated; collect a correction (bounded).
                      guard: ({ context }) => needTask(context).correctionCount < LIMITS.correctionAttempts,
                      target: '#recording',
                      actions: [
                        assign(({ context }) => {
                          const task = needTask(context);
                          return {
                            task: {
                              ...task,
                              proposedMeaning: null,
                              confirmedMeaning: null,
                              correctionCount: task.correctionCount + 1,
                              inputPurpose: 'CORRECTION' as const,
                              pendingSegments: 0,
                            },
                          };
                        }),
                        ({ context }) => emit(context, 'CONFIRMATION_NO'),
                      ],
                    },
                    {
                      target: '#fallback',
                      actions: [
                        assign(({ context }) => ({
                          fallbackReason: 'CORRECTION_LIMIT' as const,
                          ...patchTask(context, { proposedMeaning: null }),
                        })),
                        ({ context }) => emit(context, 'CONFIRMATION_NO'),
                      ],
                    },
                  ],
                  RETRY: { guard: ({ context }) => context.audioStatus === 'failed', target: 'synthesizing' },
                },
              },
            },
          },

          // ---- Translate (ZH->SV only after explicit Yes; SV->ZH directly) ----
          translating: {
            id: 'translating',
            entry: 'newRequestId',
            on: { SWITCH_REQUESTED: sw('translating') },
            invoke: {
              src: 'translate',
              input: ({ context }): TranslateIn => {
                const task = needTask(context);
                return {
                  taskId: task.id,
                  requestId: context.activeRequestId ?? '',
                  preset: task.preset,
                  // ZH->SV translates ONLY the confirmed meaning, never an unconfirmed proposal.
                  text: task.direction === 'ZH_TO_SV' ? task.confirmedMeaning : task.sourceText,
                  direction: task.direction,
                  previousDelivered: context.lastDelivered,
                };
              },
              onDone: [
                { guard: ({ context, event }) => isStale(context, event.output) },
                {
                  target: '#result',
                  actions: [
                    assign(({ context, event }) => patchTask(context, { translatedText: event.output.text })),
                    ({ context, event }) => emitStage(context, 'TRANSLATION_READY', 'translate', event.output.durationMs),
                    () => armResponse('translation'),
                  ],
                },
              ],
              onError: {
                target: '#recoverableError',
                actions: assign({
                  error: ({ event }) => ({ stage: 'translate' as const, category: errorOf(event, 'UNKNOWN') }),
                }),
              },
            },
          },

          // ---- Result: show + play target speech; remember ONLY after delivery ----
          result: {
            id: 'result',
            initial: 'synthesizing',
            exit: ['stopPlayback'],
            on: { SWITCH_REQUESTED: sw('result') },
            states: {
              synthesizing: {
                entry: [
                  'newRequestId',
                  'stopPlayback',
                  () => deps.audioStore.clearPlayback('result'),
                  assign({ audioStatus: () => 'none' as const }),
                ],
                invoke: {
                  src: 'synthesize',
                  input: synthInput('result'),
                  onDone: [
                    { guard: ({ context, event }) => isStale(context, event.output) },
                    {
                      target: 'pending',
                      actions: [
                        ({ event }) => deps.audioStore.setPlayback(event.output.slot, event.output.audio),
                        assign({ audioStatus: () => 'ready' as const }),
                        ({ context, event }) => emitStage(context, 'TTS_READY', 'tts', event.output.durationMs),
                      ],
                    },
                  ],
                  onError: {
                    target: 'ttsFailed',
                    actions: [
                      assign({ audioStatus: () => 'failed' as const }),
                      ({ context, event }) => emit(context, 'ERROR', { stage: 'tts', errorCategory: errorOf(event, 'TTS') }),
                    ],
                  },
                },
              },
              // Translation exists and is visible, but nothing is "delivered" until playback finished.
              pending: {
                on: {
                  DELIVERY_FINISHED: {
                    guard: ({ event }) => event.mode === 'audio',
                    target: 'delivered',
                    actions: [
                      assign(({ context }) => ({ lastDelivered: deliveredMemory(context) })),
                      ({ context, event }) => completeDelivery(context, event.mode),
                    ],
                  },
                  // Audio could not be played: regenerate it.
                  RETRY: 'synthesizing',
                },
              },
              // TTS failed: keep readable text; manual replay (RETRY) or explicit adult text-only acceptance.
              ttsFailed: {
                on: {
                  RETRY: 'synthesizing',
                  DELIVERY_FINISHED: {
                    guard: ({ event }) => event.mode === 'text_only',
                    target: 'delivered',
                    actions: [
                      assign(({ context }) => ({ lastDelivered: deliveredMemory(context) })),
                      ({ context, event }) => completeDelivery(context, event.mode),
                    ],
                  },
                },
              },
              delivered: {
                id: 'delivered',
                on: {
                  NEW_TURN: '#idle',
                  CANCEL: '#idle', // task is already complete: not a cancellation
                  START_TASK: {
                    target: '#recording',
                    actions: ['cleanupMedia', assign(({ context, event }) => beginTask(context, event.direction)), 'logTaskStarted'],
                  },
                  // Task is complete, so no cancel-confirmation is needed to start another direction.
                  SWITCH_REQUESTED: {
                    target: '#recording',
                    actions: ['cleanupMedia', assign(({ context, event }) => beginTask(context, event.direction)), 'logTaskStarted'],
                  },
                },
              },
            },
          },

          // ---- Recoverable failure: retry or cancel; never a false success ----
          recoverableError: {
            id: 'recoverableError',
            entry: [
              ({ context }) =>
                emit(context, 'ERROR', {
                  errorCategory: context.error?.category,
                  ...(context.error && context.error.stage !== 'recorder' ? { stage: context.error.stage } : {}),
                }),
              { type: 'speak', params: { id: 'error' } },
            ],
            exit: 'stopSpeaking',
            on: {
              RETRY: [
                { guard: ({ context }) => context.error?.stage === 'asr', target: '#transcribing', actions: assign({ error: () => null }) },
                { guard: ({ context }) => context.error?.stage === 'interpret', target: '#interpreting', actions: assign({ error: () => null }) },
                { guard: ({ context }) => context.error?.stage === 'translate', target: '#translating', actions: assign({ error: () => null }) },
                {
                  guard: ({ context }) => (context.task?.pendingSegments ?? 0) > 0,
                  target: '#segmentDecision',
                  actions: assign({ error: () => null }),
                },
                { target: '#recording', actions: assign({ error: () => null }) },
              ],
              SWITCH_REQUESTED: sw('recoverableError'),
            },
          },

          // ---- Limits reached / unresolved: restart or cancel (never guess) ----
          fallback: {
            id: 'fallback',
            entry: { type: 'speak', params: { id: 'fallback' } },
            exit: 'stopSpeaking',
            on: {
              RESTART: {
                target: '#recording',
                actions: [
                  'logCancelled',
                  'cleanupMedia',
                  assign(({ context }) => beginTask(context, needTask(context).direction)),
                  'logTaskStarted',
                ],
              },
              SWITCH_REQUESTED: sw('fallback'),
            },
          },
        },
      },

      // ------------------------------------------------------------------ SWITCH CONFIRMATION
      // Independent of Yes/No for meaning confirmation: different events (SWITCH_YES / SWITCH_NO).
      // Leaving `task` stops every in-flight actor (aborting requests); outdated results are also
      // rejected by requestId, so a failed network cancellation cannot corrupt the new state.
      confirmingSwitch: {
        id: 'confirmingSwitch',
        entry: [{ type: 'speak', params: { id: 'switch' } }, ({ context }) => emit(context, 'SWITCH_REQUESTED')],
        exit: 'stopSpeaking',
        on: {
          SWITCH_YES: {
            target: '#recording',
            actions: [
              ({ context }) => emit(context, 'SWITCH_YES'),
              'logCancelled',
              'cleanupMedia',
              // Earlier segments/counters of the cancelled task are dropped; only lastDelivered survives.
              assign(({ context }) => beginTask(context, context.pendingDirection ?? needTask(context).direction)),
              'logTaskStarted',
            ],
          },
          SWITCH_NO: [
            // Return to a safe checkpoint, keeping earlier segments/counters. Interrupted
            // work (a live recording or an in-flight request) simply restarts.
            ...(
              [
                ['recording', '#segmentDecision'],
                ['segmentDecision', '#segmentDecision'],
                ['transcribing', '#transcribing'],
                ['asrEmpty', '#asrEmpty'],
                ['interpreting', '#interpreting'],
                ['clarifying', '#clarifying'],
                ['confirming', '#confirming'],
                ['translating', '#translating'],
                ['result', '#result'],
                ['recoverableError', '#recoverableError'],
                ['fallback', '#fallback'],
              ] as Array<[SafeReturnKey, string]>
            ).map(([key, target]) => ({
              guard: ({ context }: { context: MachineContext }) =>
                context.safeReturnState === key &&
                // A first segment that was interrupted has nothing to decide on: restart recording.
                !(key === 'recording' && (context.task?.pendingSegments ?? 0) === 0),
              target,
              actions: ['logSwitchNo' as const, 'clearSwitchRequest' as const],
            })),
            {
              target: '#recording',
              actions: ['logSwitchNo' as const, 'clearSwitchRequest' as const],
            },
          ],
        },
      },
    },
  });
}

export type DialogueMachine = ReturnType<typeof createDialogueMachine>;
