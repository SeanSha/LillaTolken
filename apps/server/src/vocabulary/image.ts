import { AppError, mimeForImageKind, sniffImage, VOCABULARY_LIMITS, type ImageKind } from '@kt/shared';

export type VocabularyImage = {
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  kind: ImageKind;
};

function declaredMatches(kind: ImageKind, header: string): boolean {
  const declared = header.split(';')[0]?.trim().toLowerCase() ?? '';
  if (kind === 'jpeg') return declared === 'image/jpeg' || declared === 'image/jpg';
  if (kind === 'png') return declared === 'image/png';
  return declared === 'image/webp';
}

/** Rejects empty, oversized, unknown, or mislabeled bodies before any model call. */
export function assertVocabularyImage(bytes: Uint8Array, contentType: string): VocabularyImage {
  if (bytes.length === 0) throw new AppError('BAD_REQUEST', 'empty image');
  if (bytes.length > VOCABULARY_LIMITS.maxImageBytes) throw new AppError('BAD_REQUEST', 'image too large');
  const kind = sniffImage(bytes);
  if (!kind) throw new AppError('BAD_REQUEST', 'image type not allowed');
  if (!declaredMatches(kind, contentType)) throw new AppError('BAD_REQUEST', 'image type mismatch');
  return { bytes, mimeType: mimeForImageKind(kind), kind };
}
