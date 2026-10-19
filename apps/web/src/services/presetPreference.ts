import { PROVIDER_PRESETS, type ProviderPreset } from '@kt/shared';

const STORAGE_KEY = 'kt.preset';

export function parsePreset(value: string | null | undefined): ProviderPreset | null {
  if (!value) return null;
  return (PROVIDER_PRESETS as readonly string[]).includes(value) ? (value as ProviderPreset) : null;
}

/**
 * Which preset to start with. The `?preset=` query wins over the last choice saved on this device.
 * The adult/synthetic confirmation starts ticked. Cloud is used immediately unless that box was explicitly cleared.
 */
export function resolvePreset(options: { search: string; saved: ProviderPreset | null; cloudAcknowledged: boolean }): ProviderPreset {
  const fromUrl = parsePreset(new URLSearchParams(options.search.startsWith('?') ? options.search.slice(1) : options.search).get('preset'));
  const chosen = fromUrl ?? options.saved ?? 'mock';
  if (chosen === 'cloud' && !options.cloudAcknowledged) return 'mock';
  return chosen;
}

export function readSavedPreset(storage: Pick<Storage, 'getItem'> | null): ProviderPreset | null {
  try {
    return parsePreset(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Path + query + hash with `preset` set. Does not touch the network or history. */
export function hrefWithPreset(href: string, preset: ProviderPreset): string {
  const url = new URL(href);
  url.searchParams.set('preset', preset);
  return `${url.pathname}${url.search}${url.hash}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remember the choice on this device and put it in the address bar so a refresh keeps it. */
export function rememberPreset(preset: ProviderPreset): void {
  try {
    browserStorage()?.setItem(STORAGE_KEY, preset);
  } catch {
    // Private mode or a full store: the query string still carries the choice.
  }
  const next = hrefWithPreset(window.location.href, preset);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) history.replaceState(null, '', next);
}

export function startingPreset(): ProviderPreset {
  return resolvePreset({
    search: window.location.search,
    saved: readSavedPreset(browserStorage()),
    cloudAcknowledged: readCloudAcknowledged(),
  });
}

const ACK_KEY = 'kt.cloudAcknowledged';

/** Missing value means already confirmed. Only an explicit "0" turns the checkbox off. */
export function readCloudAcknowledged(storage: Pick<Storage, 'getItem'> | null = browserStorage()): boolean {
  try {
    const value = storage?.getItem(ACK_KEY);
    if (value == null) return true;
    return value === '1';
  } catch {
    return true;
  }
}

export function writeCloudAcknowledged(value: boolean): void {
  try {
    browserStorage()?.setItem(ACK_KEY, value ? '1' : '0');
  } catch {
    // The in-memory checkbox still works for this page load.
  }
}
