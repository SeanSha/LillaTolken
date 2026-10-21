import express, { type ErrorRequestHandler, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  APP_VERSION,
  AppError,
  DirectionSchema,
  EvalEventSchema,
  TEST_CODE_RE,
  InterpretRequestSchema,
  LanguageSchema,
  PAYLOAD_LIMITS,
  PROVIDER_PRESETS,
  PresetSchema,
  TranslateRequestSchema,
  TtsRequestSchema,
  VOCABULARY_LIMITS,
  VocabularyIdentifyResponseSchema,
  errorCodeOf,
  httpStatusFor,
  sanitizeVocabularyResponse,
  toAppError,
  type NormalizedUsage,
  type ProviderPreset,
  type RequestMeta,
  type RequestStatus,
  type TaskSnapshot,
} from '@kt/shared';
import type { ServerConfig } from './config';
import { EventStore } from './evaluation/eventStore';
import { MonitorAuth, resolveAdminPassword, sameOrigin, type AdminPassword } from './monitor/auth';
import { createMonitorRouter } from './monitor/routes';
import type { ProviderRegistry } from './providers/registry';
import { TelemetryDb } from './telemetry/db';
import { snapshotForPreset } from './telemetry/modelConfig';
import { observeBundle } from './telemetry/observe';
import { PriceRegistry } from './telemetry/pricing';
import { budgetStatus } from './telemetry/queries';
import { assertVocabularyImage } from './vocabulary/image';
import { createVocabularyIdentifier, type VocabularyIdentifier } from './vocabulary/identify';
import { recordVocabularyIdentify, vocabularyCardId } from './vocabulary/telemetry';
import { createVocabularyRouter } from './vocabulary/routes';
import { VocabularyLibraryStore } from './vocabulary/store';
import { createLocalVocabularyIdentifier } from './providers/local/vision';

type AppDeps = {
  config: ServerConfig;
  registry: ProviderRegistry;
  events?: EventStore;
  /** SQLite telemetry. Defaults to config.monitor.dbPath (tests pass ':memory:'). */
  db?: TelemetryDb;
  prices?: PriceRegistry;
  /** Photo vocabulary vision for cloud and mock. Defaults to the OpenAI Responses API. Tests inject a fake. */
  vocabulary?: VocabularyIdentifier;
  /** Photo vocabulary vision for the local preset. Defaults to the Ollama vision model. Tests inject a fake. */
  localVocabulary?: VocabularyIdentifier;
  /** Household card library. Defaults to config.vocabulary paths on first use. */
  vocabularyStore?: VocabularyLibraryStore;
};

const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

function sendError(res: Response, error: unknown): void {
  const appError = toAppError(error, 'SERVER');
  // `code` is a sanitized machine code (e.g. LOCAL_TTS_UNAVAILABLE); it never contains content.
  const code = error instanceof AppError ? error.code : undefined;
  res.status(httpStatusFor(appError.category)).json({ error: { category: appError.category, ...(code ? { code } : {}) } });
}

/** Wrap async handlers so rejections reach the error handler (Express 5 does this natively; kept explicit). */
const handler =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((error) => sendError(res, error));
  };

export function createApp({ config, registry, events, db: injectedDb, prices: injectedPrices, vocabulary, localVocabulary, vocabularyStore }: AppDeps) {
  const store = events ?? new EventStore(config.persistEvents ? config.eventsFile : undefined);
  const db = injectedDb ?? new TelemetryDb(config.monitor.dbPath);
  const prices = injectedPrices ?? PriceRegistry.fromFile(config.monitor.pricesFile);
  const admin: AdminPassword = resolveAdminPassword({
    envPassword: config.monitor.adminPassword,
    file: config.monitor.passwordFile,
    warn: (m) => console.warn(`[monitor] ${m}`),
  });
  const auth = new MonitorAuth(admin.password, config.monitor.sessionTtlMs);

  const readTestCode = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const code = value.trim().toUpperCase();
    return TEST_CODE_RE.test(code) ? code : undefined;
  };

  /** Active pairing code only. A missing, unknown or ended code never attaches a task to some other session. */
  const bindTask = (preset: ProviderPreset, testCode: string | undefined): TaskSnapshot => {
    const run = testCode ? db.findActiveTestRunByCode(testCode) : null;
    let modelConfigId: string | null = null;
    try {
      modelConfigId = db.upsertModelConfig(snapshotForPreset(preset, config, registry[preset].modelFor), new Date().toISOString());
    } catch {
      modelConfigId = null;
    }
    return {
      testRunId: run?.testRunId ?? null,
      environment: run?.environment ?? 'UNKNOWN',
      networkType: run?.networkType ?? 'UNKNOWN',
      noiseLevel: run?.noiseLevel ?? 'UNKNOWN',
      modelConfigId,
    };
  };

  // ONE telemetry wrapper per preset: every provider path writes exactly one row per invocation.
  let budgetWarned = false;
  const observed = Object.fromEntries(
    PROVIDER_PRESETS.map((p) => [
      p,
      observeBundle(registry[p].bundle, {
        db,
        prices,
        preset: p,
        providerName: registry[p].providerName,
        modelFor: registry[p].modelFor,
        resolveTaskContext: (meta) => bindTask(p, meta.testCode),
        onRecorded: ({ preset, costUsd }) => {
          if (preset !== 'cloud' || costUsd === null || process.env.NODE_ENV === 'test') return;
          const b = budgetStatus(db);
          if (b.exceeded && !budgetWarned) {
            budgetWarned = true;
            console.warn(`[budget] soft limit reached: $${b.spentUsd.toFixed(4)} of $${b.limitUsd} (${b.scopeLabel}). Alert only - not a billing stop.`);
          } else if (!b.exceeded) budgetWarned = false;
        },
      }),
    ]),
  ) as Record<ProviderPreset, ReturnType<typeof observeBundle>>;

  const app = express();
  app.disable('x-powered-by');

  // Privacy: log method/path/status/duration ONLY. Never bodies, query strings, or headers.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
      }
    });
    next();
  });

  // Mounted BEFORE the translator routes so its admin guard also covers the v1.1 export/purge.
  app.use(createMonitorRouter({ config, db, prices, registry, events: store, auth }));

  const json = express.json({ limit: '256kb' });
  const rawAudio = express.raw({ type: () => true, limit: PAYLOAD_LIMITS.maxAudioBytes });
  const rawImage = express.raw({ type: () => true, limit: VOCABULARY_LIMITS.maxImageBytes });
  const identifyVocabulary = vocabulary ?? createVocabularyIdentifier(config.openai);
  const identifyLocalVocabulary = localVocabulary ?? createLocalVocabularyIdentifier(config.local);

  /** Parses request metadata headers and resolves the provider for the (frozen) task preset. */
  function context(req: Request) {
    const presetResult = PresetSchema.safeParse(req.header('x-provider-preset') ?? 'mock');
    if (!presetResult.success) throw new AppError('BAD_REQUEST', 'unknown provider preset');
    const preset: ProviderPreset = presetResult.data;
    const registered = registry[preset];
    // `local` is never gated here: an engine problem must surface as a visible, recorded failure of
    // that call (LOCAL_*_UNAVAILABLE) - and never as a silent switch to Cloud.
    if (!registered.available && preset !== 'local') {
      throw new AppError('NOT_CONFIGURED', registered.unavailableReason ?? 'preset unavailable');
    }
    const provider = { bundle: observed[preset] };
    const taskId = req.header('x-task-id') ?? '';
    const requestId = req.header('x-request-id') ?? '';
    if (!ID_RE.test(taskId) || !ID_RE.test(requestId)) throw new AppError('BAD_REQUEST', 'missing or invalid ids');
    const sessionHeader = req.header('x-session-id') ?? '';
    const directionHeader = DirectionSchema.safeParse(req.header('x-direction'));
    const featureHeader = req.header('x-feature');
    const cardId = vocabularyCardId(req.header('x-card-id'));

    // Abort upstream work if the client goes away (e.g. cancelled task).
    const controller = new AbortController();
    res_onClose(req, () => controller.abort());
    const meta: RequestMeta = {
      taskId,
      requestId,
      signal: controller.signal,
      sessionId: ID_RE.test(sessionHeader) ? sessionHeader : undefined,
      direction: directionHeader.success ? directionHeader.data : undefined,
      feature: featureHeader === 'vocabulary' ? 'vocabulary' : undefined,
      cardId: cardId ?? undefined,
      testCode: readTestCode(req.header('x-test-code')),
    };
    return { provider, meta, preset };
  }

  function res_onClose(req: Request, fn: () => void) {
    req.on('aborted', fn);
    req.res?.on('close', () => {
      if (!req.res?.writableEnded) fn();
    });
  }

  function reqAbortedSignal(req: Request): AbortSignal {
    const controller = new AbortController();
    res_onClose(req, () => controller.abort());
    return controller.signal;
  }

  app.get('/api/health', async (_req, res) => {
    await registry.local.refresh?.().catch(() => undefined); // cheap loopback probe, cached ~2 s
    const presets = Object.fromEntries(
      PROVIDER_PRESETS.map((p) => [
        p,
        { available: registry[p].available, modelTag: registry[p].modelTag, reason: registry[p].unavailableReason },
      ]),
    );
    res.json({ ok: true, version: APP_VERSION, promptMemory: config.promptMemory, presets });
  });

  // One audio segment per request. Body = raw audio bytes; Content-Type = recorder MIME type.
  app.post(
    '/api/asr',
    rawAudio,
    handler(async (req, res) => {
      const { provider, meta } = context(req);
      const language = LanguageSchema.safeParse(req.query.language);
      if (!language.success) throw new AppError('BAD_REQUEST', 'language must be zh or sv');
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('BAD_REQUEST', 'empty audio body');
      const mockTranscriptHeader = req.header('x-mock-transcript');
      const durationHeader = Number(req.header('x-duration-ms'));
      const text = await provider.bundle.asr.transcribe(
        {
          bytes: new Uint8Array(body),
          mimeType: req.header('content-type') ?? 'application/octet-stream',
          durationMs: Number.isFinite(durationHeader) ? durationHeader : undefined,
          mockTranscript: mockTranscriptHeader ? decodeURIComponent(mockTranscriptHeader) : undefined,
        },
        language.data,
        meta,
      );
      res.json({ text });
    }),
  );

  app.post(
    '/api/interpret',
    json,
    handler(async (req, res) => {
      const { provider, meta } = context(req);
      const parsed = InterpretRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid interpret request');
      const result = await provider.bundle.dialogue.interpretChinese(
        {
          ...parsed.data,
          previousDelivered: config.promptMemory ? parsed.data.previousDelivered : null,
        },
        meta,
      );
      res.json(result);
    }),
  );

  app.post(
    '/api/translate',
    json,
    handler(async (req, res) => {
      const { provider, meta } = context(req);
      const parsed = TranslateRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid translate request');
      const translation = await provider.bundle.dialogue.translate(
        {
          ...parsed.data,
          previousDelivered: config.promptMemory ? parsed.data.previousDelivered : null,
        },
        meta,
      );
      res.json({ translation });
    }),
  );

  // Photo vocabulary. The body is the image bytes and is not persisted. Dialogue ids are not required.
  app.post(
    '/api/vocabulary/identify',
    rawImage,
    handler(async (req, res) => {
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body)) throw new AppError('BAD_REQUEST', 'image body required');
      const image = assertVocabularyImage(new Uint8Array(body), req.header('content-type') ?? '');
      const presetHeader = req.header('x-provider-preset');
      const presetResult = presetHeader === undefined ? { success: true as const, data: 'cloud' as const } : PresetSchema.safeParse(presetHeader);
      if (!presetResult.success) throw new AppError('BAD_REQUEST', 'unknown provider preset');
      const useLocal = presetResult.data === 'local';
      const signal = reqAbortedSignal(req);
      const started = Date.now();
      const usage: NormalizedUsage = {};
      let status: RequestStatus = 'succeeded';
      let errorCode: string | null = null;
      try {
        const result = await (useLocal ? identifyLocalVocabulary : identifyVocabulary).identify(image, signal, (reported) => Object.assign(usage, reported));
        const parsed = VocabularyIdentifyResponseSchema.safeParse(result);
        if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'vocabulary result failed schema validation');
        res.setHeader('Cache-Control', 'no-store');
        res.json(sanitizeVocabularyResponse(parsed.data));
      } catch (error) {
        status = signal.aborted ? 'cancelled' : error instanceof AppError && error.category === 'TIMEOUT' ? 'timeout' : 'failed';
        errorCode = errorCodeOf(error);
        throw error;
      } finally {
        try {
          recordVocabularyIdentify({
            db,
            prices,
            preset: useLocal ? 'local' : 'cloud',
            providerName: useLocal ? 'local' : 'openai',
            model: useLocal ? `ollama:${config.local.ollama.visionModel}` : config.openai.visionModel,
            cardId: vocabularyCardId(req.header('x-card-id')),
            startedAtMs: started,
            durationMs: Date.now() - started,
            status,
            errorCode,
            usage,
          });
        } catch {
          // A monitoring failure must not change the identify result.
        }
      }
    }),
  );

  let vocabularyRouter: ReturnType<typeof createVocabularyRouter> | null = null;
  app.use('/api/vocabulary', (req, res, next) => {
    vocabularyRouter ??= createVocabularyRouter(
      vocabularyStore ?? new VocabularyLibraryStore(config.vocabulary.dbPath, config.vocabulary.mediaDir),
    );
    return vocabularyRouter(req, res, next);
  });

  app.post(
    '/api/tts',
    json,
    handler(async (req, res) => {
      const { provider, meta } = context(req);
      const parsed = TtsRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid tts request');
      const audio = await provider.bundle.tts.synthesize(parsed.data.text, parsed.data.language, meta);
      res.setHeader('Content-Type', audio.mimeType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(audio.bytes));
    }),
  );

  // Application-level HTTP RTT. Authenticated by the researcher-issued test code, not the monitor password.
  // The phone measures the GET; the POST only stores that client-observed number. No audio or text.
  const rttWrites = new Map<string, number[]>();
  const allowRttWrite = (code: string, now = Date.now()): boolean => {
    const recent = (rttWrites.get(code) ?? []).filter((t) => now - t < 60_000);
    const last = recent[recent.length - 1];
    if (recent.length >= 20 || (last !== undefined && now - last < 4_000)) {
      rttWrites.set(code, recent);
      return false;
    }
    recent.push(now);
    rttWrites.set(code, recent);
    return true;
  };
  const noStore = (res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  app.get('/api/eval/ping', (req, res) => {
    noStore(res);
    if (!sameOrigin(req)) {
      res.status(403).json({ error: { code: 'BAD_ORIGIN' } });
      return;
    }
    const run = readTestCode(req.header('x-test-code'));
    const session = run ? db.findActiveTestRunByCode(run) : null;
    if (!session) {
      res.status(401).json({ error: { code: 'BAD_TEST_CODE' } });
      return;
    }
    db.touchTestRun(session.testRunId, new Date().toISOString());
    const nonce = typeof req.query.n === 'string' ? req.query.n.slice(0, 80) : '';
    res.json({ ok: true, nonce });
  });

  app.post('/api/eval/rtt', json, (req, res) => {
    noStore(res);
    if (!sameOrigin(req)) {
      res.status(403).json({ error: { code: 'BAD_ORIGIN' } });
      return;
    }
    const code = readTestCode(req.header('x-test-code'));
    const session = code ? db.findActiveTestRunByCode(code) : null;
    if (!session) {
      res.status(401).json({ error: { code: 'BAD_TEST_CODE' } });
      return;
    }
    const parsed = z.strictObject({ rttMs: z.number().finite().min(0).max(60_000), nonce: z.string().min(1).max(80) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_REQUEST' } });
      return;
    }
    if (!allowRttWrite(session.code)) {
      res.status(429).json({ error: { code: 'TOO_MANY_ATTEMPTS' } });
      return;
    }
    try {
      db.recordRtt({
        testRunId: session.testRunId,
        at: new Date().toISOString(),
        rttMs: parsed.data.rttMs,
        nonce: parsed.data.nonce,
        environment: session.environment,
        networkType: session.networkType,
        noiseLevel: session.noiseLevel,
      });
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        res.status(204).end();
        return;
      }
      res.status(500).json({ error: { category: 'SERVER' } });
      return;
    }
    res.status(204).end();
  });

  // Metadata-only evaluation events. The strict schema rejects any content-bearing field.
  app.post(
    '/api/events',
    json,
    handler(async (req, res) => {
      const body = z.object({ events: z.array(EvalEventSchema).min(1).max(100) }).safeParse(req.body);
      if (!body.success) throw new AppError('BAD_REQUEST', 'invalid events payload');
      store.add(body.data.events);
      try {
        db.ingestEvents(body.data.events, (event) => bindTask(event.providerPreset, event.testCode));
      } catch {
        // Metadata logging must never break the translator.
      }
      res.status(204).end();
    }),
  );

  // Developer-only exports.
  app.get('/api/events/export', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kidstranslator-events.csv"');
    res.send(store.toCsv());
  });
  app.delete('/api/events', (_req, res) => {
    store.clear();
    res.status(204).end();
  });

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    // body-parser errors (too large / bad JSON) land here.
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
    if (res.headersSent) return;
    res.status(status >= 400 && status < 500 ? status : 500).json({ error: { category: status < 500 ? 'BAD_REQUEST' : 'SERVER' } });
  };
  app.use(onError);

  return { app, store, db, auth, admin };
}
