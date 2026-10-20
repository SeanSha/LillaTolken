import { describe, expect, it } from 'vitest';
import { categoryFromWords, categoryIsManual, migratedCategory } from '../../apps/web/src/vocabulary/classify';

describe('vocabulary categories for existing cards', () => {
  it('maps a known word and leaves an unknown word alone', () => {
    expect(categoryFromWords('苹果', 'äpple')).toBe('food');
    expect(categoryFromWords('杯子', 'mugg')).toBe('home');
    expect(categoryFromWords('一个没见过的东西', 'okänd')).toBeNull();
  });

  it('does not replace a category a parent already chose', () => {
    expect(categoryIsManual({ category: 'toys', categorySource: 'manual' })).toBe(true);
    expect(categoryIsManual({ category: 'food' })).toBe(true);
    expect(migratedCategory({ zh: '苹果', sv: 'äpple', category: 'toys', categorySource: 'manual' })).toBeNull();
    expect(migratedCategory({ zh: '苹果', sv: 'äpple', category: 'toys' })).toBeNull();
    expect(migratedCategory({ zh: '苹果', sv: 'äpple', category: 'food', categorySource: 'auto' })).toBeNull();
  });

  it('fills 其他 only when the words decide and nobody has chosen', () => {
    expect(migratedCategory({ zh: '苹果', sv: 'äpple', category: 'other' })).toBe('food');
    expect(migratedCategory({ zh: '苹果', sv: 'äpple' })).toBe('food');
    expect(migratedCategory({ zh: '奇怪', sv: 'okänd', category: 'other' })).toBeNull();
  });
});
