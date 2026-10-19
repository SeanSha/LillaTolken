import { APP_VERSION, EvalEventSchema, type EvalEvent, type ProviderPreset } from '@kt/shared';
import type { LogFields } from '../dialogue/types';

type Options = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getScenarioId?: () => string | undefined;
  getModelTag?: (preset: ProviderPreset) => string | undefined;
  /** Synchronous observer of every logged event (e.g. to learn the current task's context). */
  onLog?: (fields: LogFields) => void;
  /** Flush interval; events are small and infrequent. */
  flushMs?: number;
};

/**
 * Metadata-only evaluation logger. It can only express the fields in EvalEventSchema, which has
 * no place for audio, transcripts, translations, prompts or lastDelivered content.
 */
export class EventLogger {
  private queue: EvalEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Local copy (counts only are shown in the dev panel). */
  readonly recorded: EvalEvent[] = [];

  constructor(private readonly options: Options = {}) {}

  log = (fields: LogFields): void => {
    this.options.onLog?.(fields);
    const candidate: EvalEvent = {
      ts: new Date().toISOString(),
      version: APP_VERSION,
      scenarioId: this.options.getScenarioId?.(),
      modelTag: this.options.getModelTag?.(fields.providerPreset),
      ...fields,
    };
    const parsed = EvalEventSchema.safeParse(candidate);
    if (!parsed.success) return; // never send something that does not match the metadata schema
    this.recorded.push(parsed.data);
    this.queue.push(parsed.data);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.options.flushMs ?? 400);
  };

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, 100);
    try {
      const fetchImpl = this.options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
      const response = await fetchImpl(`${this.options.baseUrl ?? ''}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      if (!response.ok) throw new Error('events rejected');
    } catch {
      // Evaluation logging must never disturb the dialogue. Drop on failure.
    }
    if (this.queue.length > 0) await this.flush();
  }
}
