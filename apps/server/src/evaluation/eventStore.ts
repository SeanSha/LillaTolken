import fs from 'node:fs';
import path from 'node:path';
import { EVAL_CSV_COLUMNS, type EvalEvent } from '@kt/shared';

/** Spreadsheet formula-injection guard + RFC 4180 quoting. */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function eventsToCsv(events: readonly EvalEvent[]): string {
  const rows = [EVAL_CSV_COLUMNS.join(',')];
  for (const event of events) {
    rows.push(EVAL_CSV_COLUMNS.map((col) => csvCell(event[col])).join(','));
  }
  return `${rows.join('\n')}\n`;
}

/** Metadata-only evaluation log. Content never enters this store (the schema is strict). */
export class EventStore {
  private readonly events: EvalEvent[] = [];

  constructor(private readonly persistTo?: string) {
    if (persistTo) fs.mkdirSync(path.dirname(persistTo), { recursive: true });
  }

  add(batch: EvalEvent[]): void {
    for (const event of batch) {
      this.events.push(event);
      if (this.persistTo) {
        try {
          fs.appendFileSync(this.persistTo, `${JSON.stringify(event)}\n`);
        } catch {
          // Logging must never break the app.
        }
      }
    }
  }

  all(): readonly EvalEvent[] {
    return this.events;
  }

  clear(): void {
    this.events.length = 0;
  }

  /** Also deletes the persisted NDJSON file ("Clear Adult Test Data"). */
  purge(): void {
    this.clear();
    if (this.persistTo) fs.rmSync(this.persistTo, { force: true });
  }

  toCsv(): string {
    return eventsToCsv(this.events);
  }
}
