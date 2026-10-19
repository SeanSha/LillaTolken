// Protected monitoring API (docs/SYSTEM_DESIGN.md 5.4). Every route except login/logout/session
// requires the admin cookie - including exports, pricing and local health.
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import {
  AI_STAGES,
  DirectionSchema,
  PresetSchema,
  type MonitorFilters,
  type MonitorHealthResponse,
} from '@kt/shared';
import type { ServerConfig } from '../config';
import type { EventStore } from '../evaluation/eventStore';
import type { ProviderRegistry } from '../providers/registry';
import type { TelemetryDb } from '../telemetry/db';
import { annotationsCsv, requestsCsv, tasksCsv } from '../telemetry/export';
import type { PriceRegistry } from '../telemetry/pricing';
import * as q from '../telemetry/queries';
import type { MonitorAuth } from './auth';
import {
  clearedCookie,
  clientAddress,
  isLoopbackAddress,
  readCookie,
  sameOrigin,
  sessionCookie,
  COOKIE_NAME,
} from './auth';

export type MonitorDeps = {
  config: ServerConfig;
  db: TelemetryDb;
  prices: PriceRegistry;
  registry: ProviderRegistry;
  events: EventStore;
  auth: MonitorAuth;
};

const iso = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date');

const FiltersSchema = z.object({
  from: iso.optional(),
  to: iso.optional(),
  preset: PresetSchema.optional(),
  direction: DirectionSchema.optional(),
  stage: z.enum(AI_STAGES).optional(),
  model: z.string().max(200).optional(),
  status: z.string().max(20).optional(),
  scenarioId: z.string().max(100).optional(),
});

const PageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  sort: z.string().max(30).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const YesNoNA = z.enum(['yes', 'no', 'not_assessed']);
const AnnotationSchema = z.strictObject({
  taskId: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/),
  scenarioId: z.string().max(100).nullish(),
  referenceMeaningCode: z.string().regex(/^[A-Za-z0-9_.-]{0,60}$/).nullish(),
  meaningScore: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullish(),
  recipientUnderstood: YesNoNA.optional(),
  asrIssue: YesNoNA.optional(),
  uiDifficultyCount: z.number().int().min(0).max(100).optional(),
  // Short, adult-written observation. The UI warns not to type identifiable speech.
  note: z.string().max(280).nullish(),
});

const BudgetSchema = z.strictObject({
  enabled: z.boolean(),
  limitUsd: z.number().min(0).max(100_000),
  scope: z.enum(['day', 'session']),
});

function parseFilters(req: Request): MonitorFilters {
  const parsed = FiltersSchema.safeParse(req.query);
  if (!parsed.success) throw new BadQuery();
  const f = parsed.data;
  // The UI sends "All" as an absent parameter; an empty string is treated the same way.
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as MonitorFilters;
}

class BadQuery extends Error {}

export function createMonitorRouter(deps: MonitorDeps): Router {
  const { config, db, prices, registry, events, auth } = deps;
  const router = Router();
  const json = express.json({ limit: '32kb' });

  router.use(['/api/monitor', '/api/local', '/api/events/export'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const secureCookies = (req: Request) => req.header('x-forwarded-proto') === 'https' || req.secure;

  /** Admin gate for everything that exposes metadata or diagnostics. */
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (config.monitor.localOnly && !isLoopbackAddress(clientAddress(req))) {
      res.status(403).json({ error: { code: 'LOCAL_ONLY' } });
      return;
    }
    if (!auth.isValid(readCookie(req, COOKIE_NAME))) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      return;
    }
    if (req.method !== 'GET' && !sameOrigin(req)) {
      res.status(403).json({ error: { code: 'BAD_ORIGIN' } });
      return;
    }
    next();
  };

  // ---------------------------------------------------------------- session (public)
  router.get('/api/monitor/session', (req, res) => {
    res.json({ authenticated: auth.isValid(readCookie(req, COOKIE_NAME)), localOnly: config.monitor.localOnly });
  });

  router.post('/api/monitor/login', json, (req, res) => {
    if (config.monitor.localOnly && !isLoopbackAddress(clientAddress(req))) {
      res.status(403).json({ error: { code: 'LOCAL_ONLY' } });
      return;
    }
    if (!sameOrigin(req)) {
      res.status(403).json({ error: { code: 'BAD_ORIGIN' } });
      return;
    }
    const client = clientAddress(req);
    const wait = auth.lockedFor(client);
    if (wait > 0) {
      res.status(429).json({ error: { code: 'TOO_MANY_ATTEMPTS', retryAfterSec: wait } });
      return;
    }
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== 'string' || password.length > 200 || !auth.verifyPassword(password)) {
      auth.recordFailure(client);
      res.status(401).json({ error: { code: 'BAD_PASSWORD' } });
      return;
    }
    auth.recordSuccess(client);
    const { token, maxAgeSec } = auth.createSession();
    res.setHeader('Set-Cookie', sessionCookie(token, maxAgeSec, secureCookies(req)));
    res.json({ authenticated: true });
  });

  router.post('/api/monitor/logout', (req, res) => {
    auth.revoke(readCookie(req, COOKIE_NAME));
    res.setHeader('Set-Cookie', clearedCookie(secureCookies(req)));
    res.json({ authenticated: false });
  });

  // ---------------------------------------------------------------- protected
  router.use(['/api/monitor', '/api/local'], requireAdmin);
  // The v1.1 developer export / purge are guarded too (this router is mounted before them).
  router.get('/api/events/export', requireAdmin, (_req, _res, next) => next());
  router.delete('/api/events', requireAdmin, (_req, _res, next) => next());

  router.get('/api/local/health', async (_req, res) => {
    const local = registry.local;
    const health = (await local.localHealth?.(true)) ?? null;
    res.json(health);
  });

  router.get('/api/monitor/health', async (_req, res) => {
    const local = (await registry.local.localHealth?.(true))!;
    const body: MonitorHealthResponse = {
      local,
      // Configured / not configured only: never reveals the key and never makes a billable call.
      cloud: { configured: registry.cloud.available, modelTag: registry.cloud.modelTag },
    };
    res.json(body);
  });

  router.get('/api/monitor/summary', (req, res) => {
    res.json(q.summary(db, parseFilters(req)));
  });

  router.get('/api/monitor/requests', (req, res) => {
    const page = PageSchema.parse(req.query);
    res.json(q.listRequests(db, parseFilters(req), page));
  });

  router.get('/api/monitor/requests/:rid', (req, res) => {
    const row = q.getRequest(db, String(req.params.rid));
    if (!row) {
      res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return;
    }
    res.json(row);
  });

  router.get('/api/monitor/tasks', (req, res) => {
    const page = PageSchema.parse(req.query);
    res.json(q.listTasks(db, parseFilters(req), page));
  });

  router.get('/api/monitor/tasks/:taskId', (req, res) => {
    const detail = q.getTaskDetail(db, String(req.params.taskId));
    if (!detail) {
      res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return;
    }
    res.json(detail);
  });

  router.get('/api/monitor/timeseries', (req, res) => {
    const bucket = z.enum(['hour', 'day']).default('hour').parse(req.query.bucket);
    res.json(q.timeseries(db, parseFilters(req), bucket));
  });

  router.get('/api/monitor/pricing', (_req, res) => {
    res.json(prices.describe()); // read-only: rates are edited in apps/server/config/prices.json
  });

  router.get('/api/monitor/settings', (_req, res) => {
    res.json({ budget: q.getBudgetSettings(db) });
  });

  router.post('/api/monitor/settings', json, (req, res) => {
    const parsed = z.strictObject({ budget: BudgetSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_REQUEST' } });
      return;
    }
    db.setSetting('budget', JSON.stringify(parsed.data.budget));
    res.json({ budget: q.budgetStatus(db) });
  });

  router.get('/api/monitor/annotations', (req, res) => {
    res.json(q.listAnnotations(db, parseFilters(req), PageSchema.parse(req.query)));
  });

  router.get('/api/monitor/annotations/stats', (req, res) => {
    res.json(q.annotationStats(db, parseFilters(req)));
  });

  router.post('/api/monitor/annotations', json, (req, res) => {
    const parsed = AnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_REQUEST' } });
      return;
    }
    if (!q.upsertAnnotation(db, parsed.data)) {
      res.status(404).json({ error: { code: 'TASK_NOT_FOUND' } });
      return;
    }
    res.status(204).end();
  });

  router.get('/api/monitor/export', (req, res) => {
    const type = z.enum(['requests', 'tasks', 'annotations']).safeParse(req.query.type);
    const format = z.literal('csv').safeParse(req.query.format ?? 'csv');
    if (!type.success || !format.success) {
      res.status(400).json({ error: { code: 'BAD_REQUEST' } });
      return;
    }
    const filters = parseFilters(req);
    const all = { limit: 100_000, offset: 0 };
    const csv =
      type.data === 'requests'
        ? requestsCsv(q.listRequests(db, filters, all).rows)
        : type.data === 'tasks'
          ? tasksCsv(q.listTasks(db, filters, all).rows)
          : annotationsCsv(q.listAnnotations(db, filters, all).rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kidstranslator-${type.data}.csv"`);
    res.send(csv);
  });

  /** "Clear Adult Test Data": explicit confirmation token required. */
  router.delete('/api/monitor/data', json, (req, res) => {
    if ((req.body as { confirm?: unknown } | undefined)?.confirm !== 'DELETE') {
      res.status(400).json({ error: { code: 'CONFIRMATION_REQUIRED' } });
      return;
    }
    db.clearAll();
    events.purge();
    res.status(204).end();
  });

  // Surface validation problems as 400 instead of leaking stack traces.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof BadQuery || error instanceof z.ZodError) {
      res.status(400).json({ error: { code: 'BAD_REQUEST' } });
      return;
    }
    next(error);
  });

  return router;
}
