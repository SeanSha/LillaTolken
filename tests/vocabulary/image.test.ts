import { describe, expect, it } from 'vitest';
import { sniffImage } from '@kt/shared';
import { fileInputProps } from '../../apps/web/src/vocabulary/capture';
import { JPEG_QUALITIES, MAX_EDGE, assertSourceFile, fittedSize, VocabImageError } from '../../apps/web/src/vocabulary/image';
import { assertVocabularyImage } from '../../apps/server/src/vocabulary/image';

function jpeg(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
}

describe('photo capture and image checks', () => {
  it('opens the iPhone Safari camera with capture=environment', () => {
    expect(fileInputProps('camera')).toEqual({ accept: 'image/*', capture: 'environment' });
  });

  it('keeps album upload as a fallback without forcing the camera', () => {
    const upload = fileInputProps('upload');
    expect(upload.capture).toBeUndefined();
    expect(upload.accept).toContain('image/jpeg');
    expect(upload.accept).toContain('image/heic');
  });

  it('keeps the 1280px edge and the 0.82 quality ladder', () => {
    expect(MAX_EDGE).toBe(1280);
    expect(JPEG_QUALITIES[0]).toBe(0.82);
    expect(fittedSize(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fittedSize(1000, 800)).toEqual({ width: 1000, height: 800 });
  });

  it('downscales the long edge and rejects files the browser should not decode', () => {
    expect(fittedSize(4000, 2000, 1280)).toEqual({ width: 1280, height: 640 });
    expect(fittedSize(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(() => assertSourceFile({ size: 10, type: 'image/gif' })).toThrow(VocabImageError);
    expect(() => assertSourceFile({ size: 0, type: 'image/jpeg' })).toThrow(VocabImageError);
    expect(() => assertSourceFile({ size: 20, type: '' })).not.toThrow();
  });

  it('accepts jpeg magic bytes and rejects a mislabeled or unknown body', () => {
    expect(sniffImage(jpeg())).toBe('jpeg');
    expect(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(assertVocabularyImage(jpeg(), 'image/jpg').mimeType).toBe('image/jpeg');
    expect(() => assertVocabularyImage(jpeg(), 'image/png')).toThrow(/mismatch|BAD_REQUEST/);
    expect(() => assertVocabularyImage(Uint8Array.from([1, 2, 3, 4]), 'image/jpeg')).toThrow(/not allowed|BAD_REQUEST/);
  });
});
