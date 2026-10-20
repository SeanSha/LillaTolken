import { cardCategory, type SyncRow, type VocabularyCard, type VocabularyLibrary } from './library';
import { thumbnailBlob } from './image';
import { isNotPaired, uploadCard, vocabularySession, type RemoteCard } from './remote';

export type ImportResult = {
  localId: string;
  status: 'synced' | 'pending' | 'error';
  remoteId: string | null;
  detail: string | null;
};

/** Copies one local card to the household library. The local card is never deleted. */
export async function importLocalCard(library: VocabularyLibrary, card: VocabularyCard): Promise<ImportResult> {
  const localId = card.id;
  let paired = false;
  try {
    paired = await vocabularySession();
  } catch {
    paired = false;
  }
  if (!paired) {
    const row: SyncRow = { localId, remoteId: null, status: 'pending', detail: 'not-paired' };
    await library.syncPut(row);
    return { localId, status: 'pending', remoteId: null, detail: 'not-paired' };
  }
  try {
    const thumb = card.thumb && card.thumb.size > 0 ? card.thumb : await thumbnailBlob(card.image);
    const result = await uploadCard({
      cardId: card.id,
      createdAt: card.createdAt,
      imageHash: card.imageHash,
      zh: card.zh,
      sv: card.sv,
      article: card.article,
      category: cardCategory(card),
      image: card.image,
      thumb,
      zhAudio: card.zhAudio,
      svAudio: card.svAudio,
    });
    const row: SyncRow = { localId, remoteId: result.card.id, status: 'synced', detail: result.status };
    await library.syncPut(row);
    return { localId, status: 'synced', remoteId: result.card.id, detail: result.status };
  } catch (error) {
    if (isNotPaired(error)) {
      const row: SyncRow = { localId, remoteId: null, status: 'pending', detail: 'not-paired' };
      await library.syncPut(row);
      return { localId, status: 'pending', remoteId: null, detail: 'not-paired' };
    }
    const detail = error instanceof Error ? error.name : 'error';
    const row: SyncRow = { localId, remoteId: null, status: 'error', detail };
    await library.syncPut(row);
    return { localId, status: 'error', remoteId: null, detail };
  }
}

/** Uploads every local card that is not already marked synced. One failure does not stop the rest. */
export async function importPendingCards(library: VocabularyLibrary): Promise<ImportResult[]> {
  const cards = await library.list();
  const sync = new Map((await library.syncList()).map((row) => [row.localId, row]));
  const results: ImportResult[] = [];
  for (const card of cards) {
    if (sync.get(card.id)?.status === 'synced') {
      results.push({ localId: card.id, status: 'synced', remoteId: sync.get(card.id)?.remoteId ?? null, detail: 'exists' });
      continue;
    }
    results.push(await importLocalCard(library, card));
  }
  return results;
}

export function remoteMatchesLocal(remote: RemoteCard, localId: string): boolean {
  return remote.id === localId;
}
