import { describe, expect, it } from 'vitest';
import { hrefWithPreset, parsePreset, readCloudAcknowledged, readSavedPreset, resolvePreset } from '../../apps/web/src/services/presetPreference';

describe('preset address and saved choice', () => {
  it('accepts only the three presets', () => {
    expect(parsePreset('local')).toBe('local');
    expect(parsePreset('cloud')).toBe('cloud');
    expect(parsePreset('mock')).toBe('mock');
    expect(parsePreset('openai')).toBeNull();
    expect(parsePreset(null)).toBeNull();
  });

  it('lets the query string override the saved choice', () => {
    expect(resolvePreset({ search: '?preset=local', saved: 'cloud', cloudAcknowledged: true })).toBe('local');
    expect(resolvePreset({ search: '', saved: 'local', cloudAcknowledged: false })).toBe('local');
    expect(resolvePreset({ search: '?other=1', saved: null, cloudAcknowledged: false })).toBe('mock');
  });

  it('holds cloud only when the confirmation was explicitly cleared', () => {
    expect(resolvePreset({ search: '?preset=cloud', saved: 'local', cloudAcknowledged: false })).toBe('mock');
    expect(resolvePreset({ search: '?preset=cloud', saved: 'local', cloudAcknowledged: true })).toBe('cloud');
  });

  it('treats a missing confirmation as already ticked', () => {
    expect(readCloudAcknowledged({ getItem: () => null })).toBe(true);
    expect(readCloudAcknowledged({ getItem: () => '1' })).toBe(true);
    expect(readCloudAcknowledged({ getItem: () => '0' })).toBe(false);
  });

  it('writes the preset into the address without dropping the hash', () => {
    expect(hrefWithPreset('https://mac-mini.tail96b2ac.ts.net/?x=1#top', 'local')).toBe('/?x=1&preset=local#top');
  });

  it('ignores a stored value that is not a preset', () => {
    const storage = { getItem: () => 'cloudflare' };
    expect(readSavedPreset(storage)).toBeNull();
  });
});
