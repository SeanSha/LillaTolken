import { cardCategory, type VocabularySummary } from './library';
import type { VocabularyCategoryId } from '@kt/shared';

export const GALLERY_PAGE = 24;

export type GallerySort = 'newest' | 'oldest' | 'zh' | 'sv';

export type GalleryFilter = {
  category: '' | VocabularyCategoryId;
  q: string;
  from: string;
  to: string;
  sort: GallerySort;
};

export function startOfDay(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
}

export function endOfDay(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
}

export function filterSummaries(rows: VocabularySummary[], filter: GalleryFilter): VocabularySummary[] {
  const q = filter.q.trim().toLocaleLowerCase();
  const from = startOfDay(filter.from);
  const to = endOfDay(filter.to);
  const matched = rows.filter((row) => {
    if (filter.category && cardCategory(row) !== filter.category) return false;
    if (from !== undefined && row.createdAt < from) return false;
    if (to !== undefined && row.createdAt > to) return false;
    if (!q) return true;
    return row.zh.toLocaleLowerCase().includes(q) || row.sv.toLocaleLowerCase().includes(q);
  });
  const sorted = [...matched];
  sorted.sort((a, b) => {
    if (filter.sort === 'oldest') return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    if (filter.sort === 'zh') return a.zh.localeCompare(b.zh, 'zh') || a.id.localeCompare(b.id);
    if (filter.sort === 'sv') return a.sv.localeCompare(b.sv, 'sv') || a.id.localeCompare(b.id);
    return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  });
  return sorted;
}

export function pageOf<T>(rows: T[], offset: number, limit = GALLERY_PAGE): T[] {
  return rows.slice(offset, offset + limit);
}
