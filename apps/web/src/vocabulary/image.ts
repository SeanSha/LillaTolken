import { sniffImage, VOCABULARY_LIMITS } from '@kt/shared';
import { sha256Hex } from './hash';

export const SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
/**
 * Longest edge of the JPEG sent to vision. Detail "auto" bills image tokens from the
 * provider's own resize (short side about 768px, then tiles), folded into input_tokens.
 * A smaller edge does not reduce that tile count, and JPEG quality only affects bytes.
 */
export const MAX_EDGE = 1280;
export const JPEG_QUALITIES = [0.82, 0.7, 0.55, 0.4] as const;

const SOURCE_TYPES = new Set(['', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export type VocabImageErrorCode = 'TYPE' | 'EMPTY' | 'TOO_LARGE' | 'DECODE';

export class VocabImageError extends Error {
  readonly code: VocabImageErrorCode;
  constructor(code: VocabImageErrorCode) {
    super(code);
    this.name = 'VocabImageError';
    this.code = code;
  }
}

export type PreparedImage = {
  blob: Blob;
  bytes: Uint8Array;
  hash: string;
  previewUrl: string;
};

export function fittedSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  if (width < 1 || height < 1) return { width: 1, height: 1 };
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / edge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Rejects files the phone should not try to decode. An empty MIME is allowed: iOS camera sometimes omits it. */
export function assertSourceFile(file: { size: number; type: string }): void {
  if (!SOURCE_TYPES.has(file.type.toLowerCase())) throw new VocabImageError('TYPE');
  if (file.size <= 0) throw new VocabImageError('EMPTY');
  if (file.size > SOURCE_IMAGE_BYTES) throw new VocabImageError('TOO_LARGE');
}

async function canvasJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const size = fittedSize(width, height);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new VocabImageError('DECODE');
  context.drawImage(source, 0, 0, size.width, size.height);
  for (const quality of JPEG_QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), 'image/jpeg', quality));
    if (blob && blob.size > 0 && blob.size <= VOCABULARY_LIMITS.maxImageBytes) return blob;
  }
  throw new VocabImageError('TOO_LARGE');
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some iOS photo-library files (HEIC) decode through an <img> instead.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new VocabImageError('DECODE'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downscale to a JPEG the identify route will accept. The original file is not uploaded. */
export async function compressImageFile(file: File): Promise<PreparedImage> {
  assertSourceFile(file);
  const decoded = await decode(file);
  try {
    if (decoded.width < 1 || decoded.height < 1) throw new VocabImageError('DECODE');
    const blob = await canvasJpeg(decoded.source, decoded.width, decoded.height);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (sniffImage(bytes) !== 'jpeg') throw new VocabImageError('TYPE');
    return { blob, bytes, hash: await sha256Hex(bytes), previewUrl: URL.createObjectURL(blob) };
  } finally {
    decoded.close?.();
  }
}

export const THUMB_EDGE = 320;

/** Gallery JPEG. The full card image stays out of the grid. */
export async function thumbnailBlob(source: Blob): Promise<Blob> {
  const file = new File([source], 'card.jpg', { type: source.type || 'image/jpeg' });
  const decoded = await decode(file);
  try {
    const canvas = document.createElement('canvas');
    const size = fittedSize(decoded.width, decoded.height, THUMB_EDGE);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new VocabImageError('DECODE');
    context.drawImage(decoded.source, 0, 0, size.width, size.height);
    for (const quality of [0.72, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), 'image/jpeg', quality));
      if (blob && blob.size > 0 && blob.size <= 400_000) return blob;
    }
    throw new VocabImageError('TOO_LARGE');
  } finally {
    decoded.close?.();
  }
}
