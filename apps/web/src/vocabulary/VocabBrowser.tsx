import { useEffect, useRef, useState } from 'react';
import { VOCABULARY_CATEGORIES, swedishWithArticle, vocabularyCategory, type ProviderPreset, type SwedishArticle, type VocabularyCategoryId } from '@kt/shared';
import { player } from '../services/runtime';
import { Icon } from '../ui/art';
import { BigButton } from '../ui/BigButton';
import { identifyImage } from './api';
import { CATEGORY_ICONS, categoryFromWords, categoryIsManual, migratedCategory } from './classify';
import { PRIVACY_NOTE } from './copy';
import { filterSummaries, GALLERY_PAGE, type GalleryFilter, type GallerySort } from './gallery';
import { cardCategory, type VocabularyCard, type VocabularyLibrary, type VocabularySummary } from './library';
import {
  deleteRemoteCard,
  isNotPaired,
  listRemoteCards,
  pairHousehold,
  patchRemoteCard,
  uploadRemoteAudio,
  vocabularySession,
  type RemoteCard,
} from './remote';
import { synthesizeLabel } from './speech';
import { importPendingCards } from './sync';

const EMPTY_FILTER: GalleryFilter = { category: '', q: '', from: '', to: '', sort: 'newest' };

type DeckItem = {
  source: 'local' | 'remote';
  id: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  remote?: RemoteCard;
};

export function VocabBrowser({ library, focusId, onCamera, preset }: { library: VocabularyLibrary; focusId: string | null; onCamera: () => void; preset: ProviderPreset }) {
  const [category, setCategory] = useState<'' | VocabularyCategoryId>('');
  const [locals, setLocals] = useState<VocabularySummary[]>([]);
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  const [paired, setPaired] = useState(false);
  const [remote, setRemote] = useState<RemoteCard[]>([]);
  const [remoteTotal, setRemoteTotal] = useState(0);
  const [shown, setShown] = useState(GALLERY_PAGE);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [deck, setDeck] = useState<DeckItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [parentOpen, setParentOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const openedFocus = useRef<string | null>(null);

  const reload = async () => {
    const rows = await library.listSummaries();
    let changed = false;
    for (const row of rows) {
      const next = migratedCategory(row);
      if (!next) continue;
      await library.update(row.id, { category: next, categorySource: 'auto' });
      changed = true;
      const sync = await library.syncGet(row.id);
      if (sync?.status === 'synced' && sync.remoteId) await patchRemoteCard(sync.remoteId, { category: next }).catch(() => undefined);
    }
    const fresh = changed ? await library.listSummaries() : rows;
    const sync = await library.syncList();
    setLocals(fresh);
    setSyncedIds(new Set(sync.filter((row) => row.status === 'synced').map((row) => row.localId)));
  };

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    void (async () => {
      try {
        const isPaired = await vocabularySession().catch(() => false);
        if (cancel) return;
        setPaired(isPaired);
        await reload();
        if (isPaired) {
          const page = await listRemoteCards({ category: category || undefined, sort: 'newest', limit: GALLERY_PAGE, offset: 0 });
          if (cancel) return;
          setRemote(page.cards);
          setRemoteTotal(page.total);
        } else {
          setRemote([]);
          setRemoteTotal(0);
        }
      } catch {
        if (!cancel) setRemote([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
    // reload closes over library, which stays stable for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, category]);

  const localRows = locals.filter((row) => (paired ? !syncedIds.has(row.id) : true)).filter((row) => !category || cardCategory(row) === category);
  const localPage = localRows.slice(0, shown);
  const localIds = localPage.map((row) => row.id).join(',');

  useEffect(() => {
    let cancel = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const id of localIds.split(',').filter(Boolean)) {
        const blob = (await library.thumb(id)) ?? (await library.get(id))?.image ?? null;
        if (!blob || cancel) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        next[id] = url;
      }
      if (cancel) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      setThumbs(next);
    })();
    return () => {
      cancel = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [library, localIds]);

  const tiles: DeckItem[] = [
    ...localPage.map((row) => ({ source: 'local' as const, id: row.id, zh: row.zh, sv: row.sv, article: row.article })),
    ...(paired ? remote.map((card) => ({ source: 'remote' as const, id: card.id, zh: card.zh, sv: card.sv, article: card.article, remote: card })) : []),
  ];

  const openAt = (itemIndex: number) => {
    setDeck(tiles);
    setIndex(itemIndex);
  };

  useEffect(() => {
    if (!focusId || openedFocus.current === focusId) return;
    const found = tiles.findIndex((item) => item.id === focusId);
    if (found < 0) return;
    openedFocus.current = focusId;
    openAt(found);
    // Open the card that was just saved once the grid knows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, localIds, remote.length]);

  const more = (!paired && shown < localRows.length) || (paired && remote.length < remoteTotal);

  return (
    <div className="vocab-kids">
      <div className="vocab-kids-head">
        <div className="titles">
          <div className="title">我的词卡</div>
          <div className="subtitle">My Vocabulary Cards</div>
        </div>
        <ParentHold onOpen={() => setParentOpen(true)} />
      </div>

      <div className="kid-cats" role="tablist" aria-label="Categories">
        <button type="button" className={`kid-cat${category === '' ? ' is-on' : ''}`} aria-pressed={category === ''} onClick={() => setCategory('')}>
          <span aria-hidden="true">{CATEGORY_ICONS.all}</span>
          全部
        </button>
        {VOCABULARY_CATEGORIES.map((item) => (
          <button key={item.id} type="button" className={`kid-cat${category === item.id ? ' is-on' : ''}`} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>
            <span aria-hidden="true">{CATEGORY_ICONS[item.id]}</span>
            {item.zh}
          </button>
        ))}
      </div>

      {loading && <p role="status">…</p>}
      {!loading && tiles.length === 0 && <p className="subtitle">拍一张吧</p>}

      <div className="vocab-gallery kid-grid" data-testid="vocab-gallery">
        {tiles.map((item, itemIndex) => (
          <button key={`${item.source}-${item.id}`} type="button" className="vocab-tile" data-testid="vocab-open" onClick={() => openAt(itemIndex)}>
            {item.source === 'local' ? (
              thumbs[item.id] ? <img src={thumbs[item.id]} alt="" /> : <span className="vocab-tile-fallback" />
            ) : (
              <img src={item.remote?.thumbUrl} alt="" />
            )}
            <span className="vocab-words">
              {item.zh}
              <small>{swedishWithArticle(item.article, item.sv)}</small>
            </span>
          </button>
        ))}
      </div>
      {more && (
        <button
          type="button"
          className="vocab-more"
          onClick={() => {
            if (!paired) setShown((count) => count + GALLERY_PAGE);
            else void listRemoteCards({ category: category || undefined, sort: 'newest', limit: GALLERY_PAGE, offset: remote.length }).then((page) => {
              setRemote((rows) => [...rows, ...page.cards]);
              setRemoteTotal(page.total);
            });
          }}
        >
          更多
        </button>
      )}

      {!deck && !parentOpen && (
        <button type="button" className="kid-camera" data-testid="vocab-library-camera" onClick={onCamera}>
          <Icon name="camera" />
          <span>拍照</span>
        </button>
      )}

      {deck && (
        <LearnView
          library={library}
          preset={preset}
          item={deck[index]!}
          hasPrev={index > 0}
          hasNext={index < deck.length - 1}
          onPrev={() => setIndex((value) => Math.max(0, value - 1))}
          onNext={() => setIndex((value) => Math.min(deck.length - 1, value + 1))}
          onClose={() => setDeck(null)}
          onDelete={async (item) => {
            const syncs = await library.syncList();
            const linked = item.source === 'remote' ? syncs.find((row) => row.remoteId === item.id) : await library.syncGet(item.id);
            const remoteId = item.source === 'remote' ? item.id : linked?.remoteId ?? null;
            const localId = item.source === 'local' ? item.id : linked?.localId ?? item.id;
            if (remoteId) {
              try {
                await deleteRemoteCard(remoteId);
              } catch (error) {
                const status = (error as { status?: number }).status;
                if (status !== 404) throw error;
              }
            }
            if (await library.get(localId)) await library.remove(localId);
            setRemote((rows) => rows.filter((card) => card.id !== item.id && card.id !== remoteId));
            if (item.source === 'remote') setRemoteTotal((total) => Math.max(0, total - 1));
            setLocals((rows) => rows.filter((row) => row.id !== localId && row.id !== item.id));
            setSyncedIds((ids) => {
              const nextIds = new Set(ids);
              nextIds.delete(localId);
              nextIds.delete(item.id);
              return nextIds;
            });
            const next = deck.filter((row) => row.id !== item.id && row.id !== localId && row.id !== remoteId);
            setDeck(next.length > 0 ? next : null);
            setIndex((value) => Math.min(value, Math.max(0, next.length - 1)));
          }}
        />
      )}

      {parentOpen && (
        <ParentPanel
          library={library}
          preset={preset}
          paired={paired}
          onClose={() => setParentOpen(false)}
          onChanged={() => {
            void reload();
            if (!paired) return;
            void listRemoteCards({ category: category || undefined, sort: 'newest', limit: Math.max(GALLERY_PAGE, remote.length), offset: 0 })
              .then((page) => {
                setRemote(page.cards);
                setRemoteTotal(page.total);
              })
              .catch(() => undefined);
          }}
          onPaired={(value) => setPaired(value)}
        />
      )}
    </div>
  );
}

function ParentHold({ onOpen }: { onOpen: () => void }) {
  const [progress, setProgress] = useState(0);
  const frame = useRef(0);
  const stop = () => {
    cancelAnimationFrame(frame.current);
    setProgress(0);
  };
  const start = () => {
    const began = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, (now - began) / 1600);
      setProgress(next);
      if (next >= 1) {
        setProgress(0);
        onOpen();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  return (
    <button
      type="button"
      className="parent-hold"
      data-testid="vocab-parent-hold"
      aria-label="家长，按住两秒"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="parent-hold-fill" style={{ transform: `scaleX(${progress})` }} />
      <em>家长</em>
    </button>
  );
}

function LearnView({
  library,
  preset,
  item,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onDelete,
}: {
  library: VocabularyLibrary;
  preset: ProviderPreset;
  item: DeckItem;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDelete: (item: DeckItem) => Promise<void>;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [busyPlay, setBusyPlay] = useState<'zh' | 'sv' | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const startX = useRef<number | null>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setDeleting(false);
    setPlayError(null);
  }, [item]);

  useEffect(() => {
    let created = '';
    let cancel = false;
    if (item.source === 'remote' && item.remote) {
      setImageUrl(item.remote.imageUrl);
      return;
    }
    void library.get(item.id).then((card) => {
      if (!card || cancel) return;
      created = URL.createObjectURL(card.image);
      setImageUrl(created);
    });
    return () => {
      cancel = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [library, item]);

  const play = async (language: 'zh' | 'sv') => {
    setPlayError(null);
    setBusyPlay(language);
    try {
      if (item.source === 'local') {
        const full = await library.get(item.id);
        const cached = language === 'zh' ? full?.zhAudio : full?.svAudio;
        if (cached) {
          await playBlob(cached);
          return;
        }
        const audio = await synthesizeLabel(item, language, { cardId: item.id, preset });
        const blob = new Blob([toArrayBuffer(audio.bytes)], { type: audio.mimeType });
        if (full) await library.saveAudio(item.id, language, blob);
        await playBlob(blob);
        return;
      }
      const url = language === 'zh' ? item.remote?.zhAudioUrl : item.remote?.svAudioUrl;
      if (url) {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('audio');
        await playBlob(await response.blob());
        return;
      }
      const audio = await synthesizeLabel(item, language, { cardId: item.id, preset });
      const blob = new Blob([toArrayBuffer(audio.bytes)], { type: audio.mimeType });
      await uploadRemoteAudio(item.id, language, blob).catch(() => undefined);
      await playBlob(blob);
    } catch {
      setPlayError('再试一次');
    } finally {
      setBusyPlay(null);
    }
  };

  return (
    <div
      className="vocab-learn"
      data-testid="vocab-learn"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) {
          startX.current = null;
          return;
        }
        startX.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (startX.current === null) return;
        const delta = event.clientX - startX.current;
        startX.current = null;
        if (delta > 48 && hasPrev) onPrev();
        if (delta < -48 && hasNext) onNext();
      }}
    >
      <div className="vocab-learn-bar">
        <button type="button" className="vocab-learn-close" data-testid="vocab-learn-back" aria-label="Back" onClick={onClose}>
          ←
        </button>
        <button type="button" className="vocab-learn-delete" data-testid="vocab-delete" onClick={() => setConfirmDelete(true)}>
          删掉
        </button>
      </div>
      <div className="vocab-learn-body">
        <div className="vocab-learn-photo-wrap">
          {imageUrl && <img className="vocab-learn-photo" src={imageUrl} alt="" />}
        </div>
        <div className="vocab-learn-words">
          <p className="vocab-learn-zh">{item.zh}</p>
          <p className="vocab-learn-sv">{swedishWithArticle(item.article, item.sv)}</p>
        </div>
      </div>
      <div className="vocab-learn-dock">
        <div className="split-actions vocab-play">
          <BigButton testId="vocab-play-zh" tone="red" label="Play Chinese" disabled={busyPlay !== null} onClick={() => { player.unlock(); void play('zh'); }}>
            <Icon name="sound" />
            <span>中文</span>
          </BigButton>
          <BigButton testId="vocab-play-sv" tone="blue" label="Play Swedish" disabled={busyPlay !== null} onClick={() => { player.unlock(); void play('sv'); }}>
            <Icon name="sound" />
            <span>Svenska</span>
          </BigButton>
        </div>
        {playError && <p className="warn">{playError}</p>}
        <div className="vocab-learn-nav">
          <button type="button" data-testid="vocab-prev" disabled={!hasPrev} onClick={onPrev} aria-label="Previous card">
            ‹
          </button>
          <button type="button" data-testid="vocab-next" disabled={!hasNext} onClick={onNext} aria-label="Next card">
            ›
          </button>
        </div>
      </div>
      {confirmDelete && (
        <div className="vocab-learn-confirm" role="alertdialog" aria-label="Delete card">
          <p>删掉这张词卡？</p>
          {playError && <p className="warn">{playError}</p>}
          <div className="vocab-learn-confirm-actions">
            <button type="button" data-testid="vocab-cancel-delete" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              留下
            </button>
            <button
              type="button"
              data-testid="vocab-confirm-delete"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                setPlayError(null);
                void onDelete(item).catch(() => {
                  setDeleting(false);
                  setPlayError('没删掉，再试一次');
                });
              }}
            >
              删掉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ParentPanel({
  library,
  preset,
  paired,
  onClose,
  onChanged,
  onPaired,
}: {
  library: VocabularyLibrary;
  preset: ProviderPreset;
  paired: boolean;
  onClose: () => void;
  onChanged: () => void;
  onPaired: (paired: boolean) => void;
}) {
  const [draftFilter, setDraftFilter] = useState<GalleryFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<GalleryFilter>(EMPTY_FILTER);
  const [rows, setRows] = useState<VocabularySummary[]>([]);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<VocabularyCard | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [batchCount, setBatchCount] = useState<number | null>(null);
  const [batching, setBatching] = useState(false);

  const load = async () => setRows(await library.listSummaries());
  useEffect(() => {
    void library.listSummaries().then(setRows);
  }, [library]);

  const visible = filterSummaries(rows, filter);

  const saveEdit = async () => {
    if (!editing) return;
    const next = await library.update(editing.id, {
      zh: editing.zh,
      sv: editing.sv,
      article: editing.article,
      category: cardCategory(editing),
      categorySource: 'manual',
    });
    const sync = await library.syncGet(editing.id);
    if (sync?.remoteId) {
      await patchRemoteCard(sync.remoteId, { zh: next.zh, sv: next.sv, article: next.article, category: cardCategory(next) }).catch(() => undefined);
    }
    setEditing(null);
    await load();
    onChanged();
  };

  const remove = async (id: string) => {
    const sync = await library.syncGet(id);
    await library.remove(id);
    if (sync?.remoteId) await deleteRemoteCard(sync.remoteId).catch(() => undefined);
    setPendingDelete(null);
    await load();
    onChanged();
  };

  const countBatch = async () => {
    const cards = await library.list();
    const targets = cards.filter((card) => !categoryIsManual(card) && card.categorySource !== 'auto' && !categoryFromWords(card.zh, card.sv));
    setBatchCount(targets.length);
  };

  const runBatch = async () => {
    setBatching(true);
    try {
      const cards = await library.list();
      const targets = cards.filter((card) => !categoryIsManual(card) && card.categorySource !== 'auto' && !categoryFromWords(card.zh, card.sv));
      for (const card of targets) {
        const bytes = new Uint8Array(await card.image.arrayBuffer());
        try {
          const result = await identifyImage(bytes, card.image.type || 'image/jpeg', { cardId: card.id, preset });
          const category = result.candidates[0]?.category;
          if (result.outcome !== 'object' || !category) continue;
          const current = await library.get(card.id);
          if (!current || categoryIsManual(current)) continue;
          await library.update(card.id, { category, categorySource: 'auto' });
          const sync = await library.syncGet(card.id);
          if (sync?.remoteId) await patchRemoteCard(sync.remoteId, { category }).catch(() => undefined);
        } catch {
          // One photo can fail without dropping the card or stopping the rest.
        }
      }
      setMessage('分类已经更新。这次识别记在监控的 Photo Vocabulary 里。');
      setBatchCount(null);
      await load();
      onChanged();
    } finally {
      setBatching(false);
    }
  };

  return (
    <div className="vocab-parent" data-testid="vocab-parent">
      <button type="button" className="vocab-learn-close" aria-label="Close parent settings" onClick={onClose}>
        ←
      </button>
      <div className="titles">
        <div className="title">家长</div>
        <div className="subtitle">For adults</div>
      </div>
      <p className="vocab-note">{PRIVACY_NOTE.zh}</p>
      <form
        className="vocab-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void pairHousehold(code.trim())
            .then((result) => {
              onPaired(true);
              setMessage(result.created ? '这台设备建立了家庭词库。' : '已加入这个家庭词库。');
            })
            .catch((error) => {
              if (isNotPaired(error)) onPaired(false);
              setMessage('没有配上。口令至少 8 个字符。');
            });
        }}
      >
        <input data-testid="vocab-pair-code" type="password" autoComplete="off" placeholder="家庭口令" aria-label="Household pairing code" value={code} onChange={(event) => setCode(event.target.value)} />
        <button type="submit">配对</button>
        <button
          type="button"
          disabled={!paired}
          onClick={() => {
            void importPendingCards(library).then((results) => {
              const failed = results.filter((row) => row.status === 'error').length;
              setMessage(failed ? `同步结束，有 ${failed} 张还在本机。` : '同步结束。本机卡片还在。');
              onChanged();
            });
          }}
        >
          同步本机
        </button>
      </form>
      <p className="vocab-note" data-testid="vocab-sync-status">
        {paired ? '已配对。' : '还没有配对。'}
        {message ? ` ${message}` : ''}
      </p>
      <form
        className="vocab-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(draftFilter);
        }}
      >
        <select aria-label="Category" value={draftFilter.category} onChange={(event) => setDraftFilter({ ...draftFilter, category: event.target.value as GalleryFilter['category'] })}>
          <option value="">全部分类</option>
          {VOCABULARY_CATEGORIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.zh}
            </option>
          ))}
        </select>
        <input aria-label="From date" type="date" value={draftFilter.from} onChange={(event) => setDraftFilter({ ...draftFilter, from: event.target.value })} />
        <input aria-label="To date" type="date" value={draftFilter.to} onChange={(event) => setDraftFilter({ ...draftFilter, to: event.target.value })} />
        <input aria-label="Search cards" placeholder="搜索" value={draftFilter.q} onChange={(event) => setDraftFilter({ ...draftFilter, q: event.target.value })} />
        <select aria-label="Sort" value={draftFilter.sort} onChange={(event) => setDraftFilter({ ...draftFilter, sort: event.target.value as GallerySort })}>
          <option value="newest">最新</option>
          <option value="oldest">最早</option>
          <option value="zh">中文</option>
          <option value="sv">Svenska</option>
        </select>
        <button type="submit">查找</button>
      </form>

      <div className="vocab-parent-list">
        {visible.map((row) => (
          <div key={row.id} className="vocab-parent-row">
            <button
              type="button"
              onClick={() => {
                void library.get(row.id).then((card) => card && setEditing(card));
              }}
            >
              {row.zh} · {swedishWithArticle(row.article, row.sv)} · {vocabularyCategory(cardCategory(row)).zh}
            </button>
            <button type="button" aria-label={`Delete ${row.zh}`} onClick={() => setPendingDelete(row.id)}>
              删掉
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <form
          className="vocab-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEdit();
          }}
        >
          <label>
            中文
            <input value={editing.zh} maxLength={40} onChange={(event) => setEditing({ ...editing, zh: event.target.value })} />
          </label>
          <label>
            Svenska
            <input value={editing.sv} maxLength={40} onChange={(event) => setEditing({ ...editing, sv: event.target.value })} />
          </label>
          <label>
            en / ett
            <select value={editing.article ?? 'none'} onChange={(event) => setEditing({ ...editing, article: event.target.value === 'none' ? null : (event.target.value as SwedishArticle) })}>
              <option value="none">没有冠词</option>
              <option value="en">en</option>
              <option value="ett">ett</option>
            </select>
          </label>
          <label>
            分类
            <select value={cardCategory(editing)} onChange={(event) => setEditing({ ...editing, category: event.target.value as VocabularyCategoryId, categorySource: 'manual' })}>
              {VOCABULARY_CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.zh}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">保存修改</button>
        </form>
      )}

      {pendingDelete && (
        <div className="vocab-confirm" role="alertdialog" aria-label="Delete card">
          <p>删掉这张词卡？</p>
          <div className="split-actions">
            <button type="button" data-testid="vocab-cancel-delete" onClick={() => setPendingDelete(null)}>
              留下
            </button>
            <button type="button" data-testid="vocab-confirm-delete" onClick={() => void remove(pendingDelete)}>
              删掉
            </button>
          </div>
        </div>
      )}

      <div className="vocab-note">
        <p>还没分好类的旧卡片，可以再请模型看一次照片。已经手动改过的分类不会被盖掉。</p>
        {batchCount === null ? (
          <button type="button" onClick={() => void countBatch()}>
            查看要识别的张数
          </button>
        ) : (
          <>
            <p>
              将再识别 {batchCount} 张。每张和拍一张新照片一样，记在监控的 Photo Vocabulary 里。接口没有返回用量时，金额显示 Unknown。
            </p>
            <button type="button" disabled={batching || batchCount === 0} onClick={() => void runBatch()}>
              {batching ? '…' : '开始识别'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

async function playBlob(blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await player.play({ bytes, mimeType: blob.type || 'audio/mpeg' });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
