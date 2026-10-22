import { describe, expect, it } from 'vitest';
import { createMemoryVocabularyLibrary, saveNewCard } from '../../apps/web/src/vocabulary/library';
import { findVocabularyMatch, sameVocabulary, type WordIdentity } from '../../apps/web/src/vocabulary/identity';

const word = (zh: string, sv: string, article: WordIdentity['article']): WordIdentity => ({ zh, sv, article });

describe('vocabulary word identity', () => {
  it('matches the same word across spacing, case, punctuation, and a written article', () => {
    const saved = word('汽车', 'bil', 'en');
    expect(sameVocabulary(saved, word(' 汽车 ', 'bil', 'en'))).toBe(true);
    expect(sameVocabulary(saved, word('汽车。', 'Bil', 'en'))).toBe(true);
    expect(sameVocabulary(saved, word('汽车', 'en bil', null))).toBe(true);
    expect(sameVocabulary(saved, word('汽车', ' bil ', null))).toBe(true);
    expect(sameVocabulary(word('苹果', 'äpple', 'ett'), word('苹果', 'Äpple', 'ett'))).toBe(true);
  });

  it('does not match a different word, a different article, or only one language', () => {
    expect(sameVocabulary(word('汽车', 'bil', 'en'), word('卡车', 'bil', 'en'))).toBe(false);
    expect(sameVocabulary(word('汽车', 'bil', 'en'), word('汽车', 'lastbil', 'en'))).toBe(false);
    expect(sameVocabulary(word('书', 'bok', 'en'), word('书', 'bok', 'ett'))).toBe(false);
    expect(sameVocabulary(word('书', 'en bok', null), word('山毛榉', 'ett bok', null))).toBe(false);
    expect(sameVocabulary(word('书', 'bok', 'en'), word('书', 'ett bok', 'en'))).toBe(false);
    expect(sameVocabulary(word('苹果', 'äpple', 'ett'), word('苹果', 'äpplen', 'ett'))).toBe(false);
    expect(sameVocabulary(word('', 'bil', 'en'), word('', 'bil', 'en'))).toBe(false);
  });

  it('finds a saved card after a candidate is chosen or the label is edited', async () => {
    const library = createMemoryVocabularyLibrary();
    const image = new Blob([Uint8Array.from([1])], { type: 'image/jpeg' });
    const car = await saveNewCard(library, { image, imageHash: 'red-car', zh: '汽车', sv: 'bil', article: 'en', category: 'vehicles' });
    await saveNewCard(library, { image: new Blob([Uint8Array.from([2])]), imageHash: 'apple', zh: '苹果', sv: 'äpple', article: 'ett' });

    const chosen = await findVocabularyMatch(library, word('汽车', 'bil', 'en'));
    expect(chosen?.id).toBe(car.id);

    const edited = await findVocabularyMatch(library, word('  汽车。', 'en bil', null));
    expect(edited?.id).toBe(car.id);

    expect(await findVocabularyMatch(library, word('卡车', 'lastbil', 'en'))).toBeNull();
    expect(await findVocabularyMatch(library, word('汽车', 'bil', 'ett'))).toBeNull();
  });
});
