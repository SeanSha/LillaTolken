import { AppError, isErrorCategory, type ErrorCategory, type SwedishArticle, type VocabularyCategoryId } from '@kt/shared';

type FetchLike = typeof fetch;

export type RemoteCard = {
  id: string;
  createdAt: number;
  updatedAt: number;
  imageHash: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  category: VocabularyCategoryId;
  hasZhAudio: boolean;
  hasSvAudio: boolean;
  thumbUrl: string;
  imageUrl: string;
  zhAudioUrl: string | null;
  svAudioUrl: string | null;
};

export type RemotePage = { cards: RemoteCard[]; total: number; limit: number; offset: number };

export type RemoteQuery = {
  category?: VocabularyCategoryId | '';
  from?: number;
  to?: number;
  q?: string;
  sort?: 'newest' | 'oldest' | 'zh' | 'sv';
  limit?: number;
  offset?: number;
};

async function fail(response: Response): Promise<AppError> {
  let category: ErrorCategory = response.status === 401 ? 'BAD_REQUEST' : response.status >= 500 ? 'SERVER' : 'BAD_REQUEST';
  try {
    const body = (await response.json()) as { error?: { category?: unknown } };
    if (isErrorCategory(body.error?.category)) category = body.error.category;
  } catch {
    // status-derived category
  }
  const error = new AppError(category, `HTTP ${response.status}`) as AppError & { status: number };
  error.status = response.status;
  return error;
}

async function request(path: string, init: RequestInit, fetchImpl: FetchLike): Promise<Response> {
  try {
    return await fetchImpl(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new AppError('NETWORK', 'network request failed');
  }
}

export async function vocabularySession(fetchImpl: FetchLike = fetch): Promise<boolean> {
  const response = await request('/api/vocabulary/session', {}, fetchImpl);
  if (!response.ok) throw await fail(response);
  const body = (await response.json()) as { paired?: boolean };
  return body.paired === true;
}

export async function pairHousehold(code: string, fetchImpl: FetchLike = fetch): Promise<{ created: boolean }> {
  const response = await request(
    '/api/vocabulary/pair',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) },
    fetchImpl,
  );
  if (!response.ok) throw await fail(response);
  const body = (await response.json()) as { created?: boolean };
  return { created: body.created === true };
}

export async function listRemoteCards(query: RemoteQuery, fetchImpl: FetchLike = fetch): Promise<RemotePage> {
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  if (query.q) params.set('q', query.q);
  params.set('sort', query.sort ?? 'newest');
  params.set('limit', String(query.limit ?? 24));
  params.set('offset', String(query.offset ?? 0));
  const response = await request(`/api/vocabulary/cards?${params.toString()}`, {}, fetchImpl);
  if (!response.ok) throw await fail(response);
  return (await response.json()) as RemotePage;
}

export type UploadCard = {
  cardId: string;
  createdAt: number;
  imageHash: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  category: VocabularyCategoryId;
  image: Blob;
  thumb: Blob;
  zhAudio?: Blob | null;
  svAudio?: Blob | null;
};

async function b64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function uploadCard(card: UploadCard, fetchImpl: FetchLike = fetch): Promise<{ status: 'saved' | 'exists'; card: RemoteCard }> {
  const response = await request(
    '/api/vocabulary/cards',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: card.cardId,
        createdAt: card.createdAt,
        imageHash: card.imageHash,
        zh: card.zh,
        sv: card.sv,
        article: card.article,
        category: card.category,
        imageBase64: await b64(card.image),
        thumbBase64: await b64(card.thumb),
        zhAudioBase64: card.zhAudio ? await b64(card.zhAudio) : null,
        svAudioBase64: card.svAudio ? await b64(card.svAudio) : null,
      }),
    },
    fetchImpl,
  );
  if (!response.ok) throw await fail(response);
  const body = (await response.json()) as { status: 'saved' | 'exists'; card: RemoteCard };
  return body;
}

export async function patchRemoteCard(
  id: string,
  patch: { zh?: string; sv?: string; article?: SwedishArticle | null; category?: VocabularyCategoryId },
  fetchImpl: FetchLike = fetch,
): Promise<RemoteCard> {
  const response = await request(
    `/api/vocabulary/cards/${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
    fetchImpl,
  );
  if (!response.ok) throw await fail(response);
  const body = (await response.json()) as { card: RemoteCard };
  return body.card;
}

export async function deleteRemoteCard(id: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await request(`/api/vocabulary/cards/${encodeURIComponent(id)}`, { method: 'DELETE' }, fetchImpl);
  if (!response.ok) throw await fail(response);
}

export async function uploadRemoteAudio(id: string, language: 'zh' | 'sv', audio: Blob, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await request(
    `/api/vocabulary/cards/${encodeURIComponent(id)}/audio`,
    { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/mpeg', 'X-Language': language }, body: audio },
    fetchImpl,
  );
  if (!response.ok) throw await fail(response);
}

export function isNotPaired(error: unknown): boolean {
  return error instanceof AppError && (error as AppError & { status?: number }).status === 401;
}
