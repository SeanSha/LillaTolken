const ACCEPT_UPLOAD = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

/**
 * iPhone Safari opens the camera when a file input is activated with `capture="environment"`
 * from a tap. The upload control omits `capture`, so the photo library stays available.
 */
export function fileInputProps(kind: 'camera' | 'upload'): { accept: string; capture?: 'environment' } {
  if (kind === 'camera') return { accept: 'image/*', capture: 'environment' };
  return { accept: ACCEPT_UPLOAD };
}
