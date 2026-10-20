import { describe, expect, it } from 'vitest';
import { filterSummaries, GALLERY_PAGE, pageOf, type GalleryFilter } from '../../apps/web/src/vocabulary/gallery';
import type { VocabularySummary } from '../../apps/web/src/vocabulary/library';

const filter: GalleryFilter = { category: '', q: '', from: '', to: '', sort: 'newest' };

function row(i: number): VocabularySummary {
  return {
    id: `card-${i}`,
    createdAt: Date.UTC(2026, 0, 1) + i * 86_400_000,
    imageHash: `hash-${i}`,
    zh: i % 2 === 0 ? `苹果${i}` : `杯子${i}`,
    sv: i % 2 === 0 ? `apple${i}` : `mugg${i}`,
    article: i % 2 === 0 ? 'ett' : 'en',
    category: i % 2 === 0 ? 'food' : 'home',
    hasZhAudio: false,
    hasSvAudio: false,
    hasThumb: false,
  };
}

describe('vocabulary gallery paging', () => {
  it('shows one page of a 500 card library and can filter by category', () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(i));
    rows[20] = { ...rows[20]!, sv: 'unik', zh: '唯一' };
    const newest = filterSummaries(rows, filter);
    expect(pageOf(newest, 0)).toHaveLength(GALLERY_PAGE);
    expect(pageOf(newest, 0)[0]?.id).toBe('card-499');
    expect(pageOf(newest, 480)).toHaveLength(20);
    const food = filterSummaries(rows, { ...filter, category: 'food', sort: 'zh' });
    expect(food.every((card) => card.category === 'food')).toBe(true);
    expect(food[0]?.zh.localeCompare(food[1]?.zh ?? '', 'zh')).toBeLessThanOrEqual(0);
    const found = filterSummaries(rows, { ...filter, q: 'unik' });
    expect(found.map((card) => card.sv)).toEqual(['unik']);
  });
});
