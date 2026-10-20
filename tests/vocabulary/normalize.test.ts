import { describe, expect, it } from 'vitest';
import { AppError } from '@kt/shared';
import { normalizeVocabularyModelOutput } from '../../apps/server/src/vocabulary/normalize';
import { VOCABULARY_INSTRUCTIONS } from '../../apps/server/src/vocabulary/identify';

const apple = { zh: '苹果', sv: 'äpple', article: 'ett' as const, translationUncertain: false };

describe('normalizeVocabularyModelOutput', () => {
  it('keeps one concrete object and maps article none to null', () => {
    expect(normalizeVocabularyModelOutput({ outcome: 'object', candidates: [apple] })).toEqual({
      outcome: 'object',
      candidates: [{ ...apple, category: 'other' }],
    });
    expect(
      normalizeVocabularyModelOutput({
        outcome: 'object',
        candidates: [{ ...apple, category: 'food' }],
      }).candidates[0]?.category,
    ).toBe('food');
    expect(
      normalizeVocabularyModelOutput({
        outcome: 'object',
        candidates: [{ ...apple, category: 'not-a-category' }],
      }).candidates[0]?.category,
    ).toBe('other');
    expect(
      normalizeVocabularyModelOutput({
        outcome: 'object',
        candidates: [{ zh: '水', sv: 'vatten', article: 'none', translationUncertain: false }],
      }).candidates[0]?.article,
    ).toBeNull();
  });

  it('does not keep a guessed label when the model is uncertain', () => {
    const result = normalizeVocabularyModelOutput({
      outcome: 'uncertain',
      candidates: [{ zh: '猫', sv: 'katt', article: 'en', translationUncertain: false }],
    });
    expect(result).toEqual({ outcome: 'uncertain', candidates: [] });
    expect(JSON.stringify(result)).not.toContain('猫');
  });

  it('drops person labels and asks for another photo instead of naming anyone', () => {
    expect(normalizeVocabularyModelOutput({ outcome: 'person', candidates: [{ zh: '孩子', sv: 'barn', article: 'ett', translationUncertain: false }] })).toEqual({
      outcome: 'person',
      candidates: [],
    });
    expect(normalizeVocabularyModelOutput({ outcome: 'object', candidates: [{ zh: '孩子', sv: 'barn', article: 'ett', translationUncertain: false }] }).outcome).toBe('person');
  });

  it('turns a blank translation into uncertain instead of inventing the missing word', () => {
    expect(
      normalizeVocabularyModelOutput({
        outcome: 'object',
        candidates: [{ zh: '杯子', sv: '', article: 'en', translationUncertain: true }],
      }),
    ).toEqual({ outcome: 'uncertain', candidates: [] });
  });

  it('keeps an unsure but complete translation for the user to correct', () => {
    const result = normalizeVocabularyModelOutput({
      outcome: 'object',
      candidates: [{ zh: '杯子', sv: 'mugg', article: 'en', translationUncertain: true }],
    });
    expect(result.outcome).toBe('object');
    expect(result.candidates[0]?.translationUncertain).toBe(true);
  });

  it('asks the user to choose when several objects remain', () => {
    const result = normalizeVocabularyModelOutput({
      outcome: 'multiple',
      candidates: [apple, { zh: '杯子', sv: 'mugg', article: 'en', translationUncertain: false }],
    });
    expect(result.outcome).toBe('multiple');
    expect(result.candidates).toHaveLength(2);
  });

  it('collapses to one object when only one candidate is usable', () => {
    const result = normalizeVocabularyModelOutput({
      outcome: 'multiple',
      candidates: [apple, { zh: '', sv: '', article: 'none', translationUncertain: true }],
    });
    expect(result.outcome).toBe('object');
    expect(result.candidates.map((c) => c.zh)).toEqual(['苹果']);
  });

  it('rejects a payload that is not the schema', () => {
    expect(() => normalizeVocabularyModelOutput({ outcome: 'object', candidates: [{ zh: '苹果' }] })).toThrow(AppError);
  });

  it('tells the model not to guess and not to name people', () => {
    expect(VOCABULARY_INSTRUCTIONS).toMatch(/Do not guess/i);
    expect(VOCABULARY_INSTRUCTIONS).toMatch(/person/i);
    expect(VOCABULARY_INSTRUCTIONS).toMatch(/category/);
  });
});
