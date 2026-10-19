import express, { type ErrorRequestHandler, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  APP_VERSION,
  AppError,
  DirectionSchema,
  EvalEventSchema,
  InterpretRequestSchema,
  LanguageSchema,
  PAYLOAD_LIMITS,
  PROVIDER_PRESETS,
  PresetSchema,
  TranslateRequestSchema,
  TtsRequestSchema,
  httpStatusFor,
  toAppError,
  type ProviderPreset,
  type RequestMeta,
} from '@kt/shared';
import type { ServerConfig } from './config';
import { EventStore } from './evaluation/eventStore';
import { MonitorAuth, resolveAdminPassword, type AdminPassword } from './monitor/auth';
import { createMonitorRouter } from './monitor/routes';
import type { ProviderRegistry } from './providers/registry';
import { TelemetryDb } from './telemetry/db';
import { observeBundle } from './telemetry/observe';
import { PriceRegistry } from './telemetry/pricing';
import { budgetStatus } from './telemetry/queries';

type AppDeps = {
  config: ServerConfig;
  registry: ProviderRegistry;
  events?: EventStore;
  /** SQLite telemetry. Defaults to config.monitor.dbPath (tests pass ':memory:'). */
  db?: TelemetryDb;
  prices?: PriceRegistry;
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

export function createApp({ config, registry, events, db: injectedDb, prices: injectedPrices }: AppDeps) {
  const store = events ?? new EventStore(config.persistEvents ? config.eventsFile : undefined);
  const db = injectedDb ?? new TelemetryDb(config.monitor.dbPath);
  const prices = injectedPrices ?? PriceRegistry.fromFile(config.monitor.pricesFile);
  const admin: AdminPassword = resolveAdminPassword({
    envPassword: config.monitor.adminPassword,
    file: config.monitor.passwordFile,
    warn: (m) => console.warn(`[monitor] ${m}`),
  });
  const auth = new MonitorAuth(admin.password, config.monitor.sessionTtlMs);

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

    // Abort upstream work if the client goes away (e.g. cancelled task).
    const controller = new AbortController();
    res_onClose(req, () => controller.abort());
    const meta: RequestMeta = {
      taskId,
      requestId,
      signal: controller.signal,
      sessionId: ID_RE.test(sessionHeader) ? sessionHeader : undefined,
      direction: directionHeader.success ? directionHeader.data : undefined,
    };
    return { provider, meta, preset };
  }

  function res_onClose(req: Request, fn: () => void) {
    req.on('aborted', fn);
    req.res?.on('close', () => {
      if (!req.res?.writableEnded) fn();
    });
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

  // Metadata-only evaluation events. The strict schema rejects any content-bearing field.
  app.post(
    '/api/events',
    json,
    handler(async (req, res) => {
      const body = z.object({ events: z.array(EvalEventSchema).min(1).max(100) }).safeParse(req.body);
      if (!body.success) throw new AppError('BAD_REQUEST', 'invalid events payload');
      store.add(body.data.events);
      try {
        db.ingestEvents(body.data.events);
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
