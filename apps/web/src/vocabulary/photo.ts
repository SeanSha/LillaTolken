import type { VocabularyCard, VocabularyLibrary } from './library';
import { DuplicateCardError } from './library';
import { thumbnailBlob } from './image';
import { replaceRemoteImage } from './remote';

type FetchLike = typeof fetch;

export class PhotoReplaceError extends Error {
  constructor(message = 'PHOTO_REPLACE_FAILED') {
    super(message);
    this.name = 'PhotoReplaceError';
  }
}

async function thumbFor(image: Blob, thumb: Blob | null | undefined): Promise<Blob | null> {
  if (thumb && thumb.size > 0) return thumb;
  try {
    return await thumbnailBlob(image);
  } catch {
    return null;
  }
}

/**
 * Replaces one card's photo. Words, category, audio, and id are copied through unchanged.
 * A synced card is updated on the household library first. If the local write then fails,
 * the previous photo is put back. No vision, speech, or language-model call is made.
 */
export async function replaceCardPhoto(
  library: VocabularyLibrary,
  cardId: string,
  next: { image: Blob; imageHash: string; thumb?: Blob | null },
  fetchImpl?: FetchLike,
): Promise<VocabularyCard> {
  const current = await library.get(cardId);
  if (!current) throw new PhotoReplaceError('MISSING_CARD');
  if (current.imageHash === next.imageHash) return current;
  const clash = await library.findByHash(next.imageHash);
  if (clash && clash.id !== cardId) throw new PhotoReplaceError('IMAGE_IN_USE');

  const sync = await library.syncGet(cardId);
  const remoteId = sync?.status === 'synced' ? sync.remoteId : null;
  const thumb = await thumbFor(next.image, next.thumb);
  if (remoteId) {
    if (!thumb) throw new PhotoReplaceError('THUMB_FAILED');
    await replaceRemoteImage(remoteId, { imageHash: next.imageHash, image: next.image, thumb }, fetchImpl);
  }

  try {
    return await library.replaceImage(cardId, { image: next.image, thumb, imageHash: next.imageHash });
  } catch (error) {
    if (remoteId && thumb) {
      const oldThumb = current.thumb && current.thumb.size > 0 ? current.thumb : thumb;
      await replaceRemoteImage(remoteId, { imageHash: current.imageHash, image: current.image, thumb: oldThumb }, fetchImpl).catch(async () => {
        await library.syncPut({ localId: cardId, remoteId, status: 'error', detail: 'image-revert-failed' });
      });
    }
    if (error instanceof DuplicateCardError) throw new PhotoReplaceError('IMAGE_IN_USE');
    throw error;
  }
}

/** Household card that is not stored on this device. Still no model call. */
export async function replaceRemotePhoto(
  remoteId: string,
  next: { image: Blob; imageHash: string },
  fetchImpl?: FetchLike,
): Promise<void> {
  const thumb = await thumbFor(next.image, null);
  if (!thumb) throw new PhotoReplaceError('THUMB_FAILED');
  await replaceRemoteImage(remoteId, { imageHash: next.imageHash, image: next.image, thumb }, fetchImpl);
}
