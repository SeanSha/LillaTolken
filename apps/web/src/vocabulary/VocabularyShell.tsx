import { useEffect, useMemo, useRef, useState } from 'react';
import { swedishWithArticle, type ProviderPreset, type SwedishArticle, type VocabularyCandidate, type VocabularyIdentifyResponse } from '@kt/shared';
import { player } from '../services/runtime';
import { Icon, Mascot } from '../ui/art';
import { BigButton } from '../ui/BigButton';
import { identifyImage } from './api';
import { reportVocabAction } from './actions';
import { fileInputProps } from './capture';
import { identificationNotice, imageErrorCopy, vocabularyErrorCopy } from './copy';
import { VocabImageError, compressImageFile, thumbnailBlob, type PreparedImage } from './image';
import { findVocabularyMatch } from './identity';
import { DuplicateCardError, cacheCardAudio, createIndexedDbVocabularyLibrary, saveNewCard, type VocabularyCard } from './library';
import { PhotoReplaceError, replaceCardPhoto } from './photo';
import { canSaveDraft, labelForSpeech, synthesizeLabel } from './speech';
import { claimRecognition, releaseRecognition, stepAfterIdentify, type Draft } from './flow';
import { importLocalCard } from './sync';
import { VocabBrowser } from './VocabBrowser';

type Stage =
  | { name: 'capture' }
  | { name: 'preview'; image: PreparedImage; cardId: string }
  | { name: 'identifying'; image: PreparedImage; cardId: string }
  | { name: 'choose'; image: PreparedImage; candidates: VocabularyCandidate[]; cardId: string }
  | { name: 'draft'; image: PreparedImage; draft: Draft; banner: 'uncertain' | 'check' | null; cardId: string }
  | { name: 'replace'; image: PreparedImage; existing: VocabularyCard; draft: Draft; cardId: string }
  | { name: 'blocked'; image: PreparedImage; outcome: 'person' | 'none'; cardId: string }
  | { name: 'card'; card: VocabularyCard; note?: string }
  | { name: 'library' }
  | { name: 'error'; image: PreparedImage | null; zh: string; sv: string; cardId?: string };

function stageAfterIdentify(image: PreparedImage, result: VocabularyIdentifyResponse, cardId: string): Stage {
  const step = stepAfterIdentify(result);
  if (step.kind === 'blocked') return { name: 'blocked', image, outcome: step.outcome, cardId };
  if (step.kind === 'choose') return { name: 'choose', image, candidates: step.candidates, cardId };
  return { name: 'draft', image, draft: step.draft, banner: step.banner, cardId };
}

export function VocabularyShell({ entry, openingFile = null, preset }: { entry: 'photo' | 'library'; openingFile?: File | null; preset: ProviderPreset }) {
  const library = useMemo(() => createIndexedDbVocabularyLibrary(), []);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<PreparedImage | null>(null);
  const identifyLock = useRef(false);
  const choosing = useRef(false);
  const [stage, setStage] = useState<Stage>(entry === 'library' ? { name: 'library' } : { name: 'capture' });
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [clips, setClips] = useState<{ zh: Blob | null; sv: Blob | null }>({ zh: null, sv: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [busyPlay, setBusyPlay] = useState<'zh' | 'sv' | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl);
    };
  }, []);

  const rememberImage = (image: PreparedImage | null) => {
    if (imageRef.current && imageRef.current !== image) URL.revokeObjectURL(imageRef.current.previewUrl);
    imageRef.current = image;
  };

  const onFile = async (list: FileList | File | null) => {
    const file = list instanceof File ? list : list?.[0];
    if (!file) return;
    try {
      const image = await compressImageFile(file);
      rememberImage(image);
      setClips({ zh: null, sv: null });
      setSaveError(false);
      setReplaceError(null);
      setPlayError(null);
      setStage({ name: 'preview', image, cardId: crypto.randomUUID() });
    } catch (error) {
      const copy = imageErrorCopy(error instanceof VocabImageError ? error.code : 'DECODE');
      setStage({ name: 'error', image: stageImage(stage), zh: copy.zh, sv: copy.sv, cardId: 'cardId' in stage ? stage.cardId : undefined });
    }
  };

  const openedFile = useRef(false);
  useEffect(() => {
    if (!openingFile || openedFile.current) return;
    openedFile.current = true;
    void onFile(openingFile);
    // The home button already opened the camera. This only turns that photo into the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingFile]);

  const onIdentify = async () => {
    if (stage.name !== 'preview') return;
    if (claimRecognition(identifyLock) === 'blocked') {
      reportVocabAction('prevented_duplicate_request', preset, stage.cardId);
      return;
    }
    const image = stage.image;
    const cardId = stage.cardId;
    setStage({ name: 'identifying', image, cardId });
    try {
      const samePhoto = await library.findByHash(image.hash);
      if (samePhoto) {
        reportVocabAction('exact_image_reuse', preset, samePhoto.id);
        setFocusId(samePhoto.id);
        setStage({ name: 'library' });
        return;
      }
      const result = await identifyImage(image.bytes, 'image/jpeg', { cardId, preset });
      setClips({ zh: null, sv: null });
      setStage(stageAfterIdentify(image, result, cardId));
    } catch (error) {
      const copy = vocabularyErrorCopy(error);
      setStage({ name: 'error', image, zh: copy.zh, sv: copy.sv, cardId });
    } finally {
      releaseRecognition(identifyLock);
    }
  };

  const showDuplicate = (image: PreparedImage, draft: Draft, cardId: string, existing: VocabularyCard) => {
    reportVocabAction('duplicate_detected', preset, existing.id);
    setReplaceError(null);
    setStage({ name: 'replace', image, existing, draft, cardId });
  };

  const commitCandidate = async (candidate: VocabularyCandidate) => {
    if (stage.name !== 'choose' || choosing.current) return;
    choosing.current = true;
    const draft: Draft = {
      zh: candidate.zh,
      sv: candidate.sv,
      article: candidate.article,
      translationUncertain: candidate.translationUncertain,
      category: candidate.category,
    };
    try {
      const existing = await findVocabularyMatch(library, draft);
      if (existing) {
        showDuplicate(stage.image, draft, stage.cardId, existing);
        return;
      }
      setStage({
        name: 'draft',
        image: stage.image,
        cardId: stage.cardId,
        draft,
        banner: candidate.translationUncertain ? 'check' : null,
      });
    } finally {
      choosing.current = false;
    }
  };

  const onSave = async () => {
    if (stage.name !== 'draft' || saving || !canSaveDraft(stage.draft)) return;
    setSaving(true);
    setSaveError(false);
    try {
      const existingWord = await findVocabularyMatch(library, stage.draft);
      if (existingWord) {
        showDuplicate(stage.image, stage.draft, stage.cardId, existingWord);
        return;
      }
      let thumb: Blob | null = null;
      try {
        thumb = await thumbnailBlob(stage.image.blob);
      } catch {
        thumb = null;
      }
      const card = await saveNewCard(library, {
        id: stage.cardId,
        image: stage.image.blob,
        thumb,
        imageHash: stage.image.hash,
        zh: stage.draft.zh,
        sv: stage.draft.sv,
        article: stage.draft.article,
        category: stage.draft.category,
        zhAudio: clips.zh,
        svAudio: clips.sv,
      });
      await importLocalCard(library, card);
      reportVocabAction('card_created', preset, card.id);
      setFocusId(card.id);
      setStage({ name: 'library' });
    } catch (error) {
      if (error instanceof DuplicateCardError) {
        const existing = await library.get(error.existingId);
        if (existing) {
          setFocusId(existing.id);
          setStage({ name: 'library' });
          return;
        }
      }
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const leaveReplace = (choice: 'keep' | 'cancel') => {
    if (stage.name !== 'replace') return;
    if (choice === 'keep') reportVocabAction('keep_existing_photo', preset, stage.existing.id);
    const id = stage.existing.id;
    rememberImage(null);
    setReplaceError(null);
    setFocusId(id);
    setStage({ name: 'library' });
  };

  const confirmNewPhoto = async () => {
    if (stage.name !== 'replace' || saving) return;
    setSaving(true);
    setReplaceError(null);
    const { image, draft, cardId, existing } = stage;
    try {
      const match = await findVocabularyMatch(library, draft);
      if (!match) {
        let thumb: Blob | null = null;
        try {
          thumb = await thumbnailBlob(image.blob);
        } catch {
          thumb = null;
        }
        const card = await saveNewCard(library, {
          id: cardId,
          image: image.blob,
          thumb,
          imageHash: image.hash,
          zh: draft.zh,
          sv: draft.sv,
          article: draft.article,
          category: draft.category,
          zhAudio: clips.zh,
          svAudio: clips.sv,
        });
        await importLocalCard(library, card);
        reportVocabAction('card_created', preset, card.id);
        rememberImage(null);
        setFocusId(card.id);
        setStage({ name: 'library' });
        return;
      }
      const card = await replaceCardPhoto(library, match.id, { image: image.blob, imageHash: image.hash });
      reportVocabAction('replace_after_duplicate', preset, card.id);
      rememberImage(null);
      setFocusId(card.id);
      setStage({ name: 'library' });
    } catch (error) {
      setReplaceError(error instanceof PhotoReplaceError && error.message === 'IMAGE_IN_USE' ? '这张照片已经有了。' : '没换上。再试一次。');
      setFocusId(existing.id);
    } finally {
      setSaving(false);
    }
  };

  const playDraft = async (language: 'zh' | 'sv') => {
    if (stage.name !== 'draft') return;
    if (!labelForSpeech(stage.draft, language)) return;
    setPlayError(null);
    setBusyPlay(language);
    try {
      let blob = clips[language];
      if (!blob) {
        const audio = await synthesizeLabel(stage.draft, language, { cardId: stage.cardId, preset });
        blob = new Blob([toArrayBuffer(audio.bytes)], { type: audio.mimeType });
        setClips((prev) => ({ ...prev, [language]: blob }));
      }
      await playBlob(blob);
    } catch (error) {
      setPlayError(vocabularyErrorCopy(error).zh);
    } finally {
      setBusyPlay(null);
    }
  };

  const playCard = async (card: VocabularyCard, language: 'zh' | 'sv') => {
    if (!labelForSpeech(card, language)) return;
    setPlayError(null);
    setBusyPlay(language);
    try {
      const cached = language === 'zh' ? card.zhAudio : card.svAudio;
      let blob = cached;
      let next = card;
      if (!blob) {
        const audio = await synthesizeLabel(card, language, { cardId: card.id, preset });
        blob = new Blob([toArrayBuffer(audio.bytes)], { type: audio.mimeType });
        next = await cacheCardAudio(library, card.id, language, blob);
        setStage((current) => (current.name === 'card' && current.card.id === next.id ? { ...current, card: next } : current));
      }
      await playBlob(blob);
    } catch (error) {
      setPlayError(vocabularyErrorCopy(error).zh);
    } finally {
      setBusyPlay(null);
    }
  };

  const commitDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete;
    setPendingDelete(null);
    await library.remove(id);
    setStage((current) => (current.name === 'card' && current.card.id === id ? { name: 'library' } : current));
  };

  const cameraProps = fileInputProps('camera');
  const uploadProps = fileInputProps('upload');

  return (
    <div className={`screen vocab vocab-${stage.name}`}>
      <input
        ref={cameraRef}
        type="file"
        accept={cameraProps.accept}
        capture={cameraProps.capture}
        hidden
        data-testid="vocab-camera-input"
        onChange={(event) => {
          void onFile(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept={uploadProps.accept}
        hidden
        data-testid="vocab-upload-input"
        onChange={(event) => {
          void onFile(event.target.files);
          event.target.value = '';
        }}
      />

      {stage.name === 'capture' && openingFile && (
        <div role="status">
          <Mascot mood="think" />
        </div>
      )}

      {stage.name === 'capture' && !openingFile && (
        <>
          <div className="titles">
            <div className="title">拍照识字</div>
            <div className="subtitle">Photo Vocabulary</div>
          </div>
          <Mascot mood="happy" />
          <div className="stack-actions">
            <BigButton testId="vocab-camera" tone="purple" label="Photo Vocabulary camera" onClick={() => cameraRef.current?.click()}>
              <Icon name="camera" />
              <span>拍照</span>
            </BigButton>
            <BigButton testId="vocab-upload" tone="orange" label="Upload a photo" onClick={() => uploadRef.current?.click()}>
              <span>从相册选</span>
            </BigButton>
            <BigButton testId="vocab-open-library" tone="gray" label="My Vocabulary Cards" onClick={() => setStage({ name: 'library' })}>
              <span>我的词卡</span>
            </BigButton>
          </div>
        </>
      )}

      {stage.name === 'preview' && (
        <>
          <img className="vocab-preview" src={stage.image.previewUrl} alt="" data-testid="vocab-preview" />
          <p className="vocab-note">拍一个东西。不要拍人。</p>
          <div className="stack-actions">
            <BigButton testId="vocab-identify" tone="green" label="Identify the object" onClick={() => void onIdentify()}>
              <span>认一认</span>
            </BigButton>
            <BigButton testId="vocab-retake" tone="gray" label="Choose another photo" onClick={() => cameraRef.current?.click()}>
              <span>换一张</span>
            </BigButton>
            <BigButton testId="vocab-upload" tone="orange" label="Upload a photo" onClick={() => uploadRef.current?.click()}>
              <span>从相册选</span>
            </BigButton>
          </div>
        </>
      )}

      {stage.name === 'identifying' && (
        <div role="status">
          <Mascot mood="think" />
          <div className="titles">
            <div className="title">看一看</div>
            <div className="subtitle">Tittar…</div>
          </div>
        </div>
      )}

      {stage.name === 'blocked' && <Blocked outcome={stage.outcome} onCamera={() => cameraRef.current?.click()} onUpload={() => uploadRef.current?.click()} />}

      {stage.name === 'choose' && (
        <>
          <img className="vocab-preview" src={stage.image.previewUrl} alt="" />
          <div className="titles">
            <div className="title">是哪一个?</div>
            <div className="subtitle">Vilken sak?</div>
          </div>
          <div className="choice-list">
            {stage.candidates.map((candidate) => (
              <BigButton
                key={`${candidate.zh}-${candidate.sv}`}
                tone="blue"
                label={`${candidate.zh} ${swedishWithArticle(candidate.article, candidate.sv)}`}
                testId="vocab-choice"
                onClick={() => void commitCandidate(candidate)}
              >
                <span>
                  {candidate.zh} · {swedishWithArticle(candidate.article, candidate.sv)}
                </span>
              </BigButton>
            ))}
          </div>
        </>
      )}

      {stage.name === 'draft' && (
        <DraftView
          image={stage.image}
          draft={stage.draft}
          banner={stage.banner}
          canSave={canSaveDraft(stage.draft)}
          saving={saving}
          saveError={saveError}
          playError={playError}
          busyPlay={busyPlay}
          onDraft={(draft) => {
            setStage({ name: 'draft', image: stage.image, cardId: stage.cardId, draft, banner: stage.banner });
            setClips((prev) => ({
              zh: draft.zh.trim() === stage.draft.zh.trim() ? prev.zh : null,
              sv: draft.sv.trim() === stage.draft.sv.trim() && draft.article === stage.draft.article ? prev.sv : null,
            }));
          }}
          onPlay={(language) => {
            player.unlock();
            void playDraft(language);
          }}
          onSave={() => void onSave()}
          onRetake={() => cameraRef.current?.click()}
        />
      )}

      {stage.name === 'replace' && (
        <div className="vocab-replace" data-testid="vocab-replace">
          <button type="button" className="vocab-learn-close" data-testid="vocab-replace-cancel" aria-label="Cancel" onClick={() => leaveReplace('cancel')}>
            ←
          </button>
          <p className="vocab-replace-title">你已经有这个词啦！</p>
          <p className="vocab-learn-zh">{stage.existing.zh}</p>
          <p className="vocab-learn-sv">{swedishWithArticle(stage.existing.article, stage.existing.sv)}</p>
          <div className="vocab-replace-photos">
            <figure>
              <BlobImage blob={stage.existing.image} className="vocab-replace-photo" />
              <figcaption>旧照片</figcaption>
            </figure>
            <figure>
              <img src={stage.image.previewUrl} alt="" data-testid="vocab-new-photo" />
              <figcaption>新照片</figcaption>
            </figure>
          </div>
          {replaceError && (
            <p className="warn" role="alert">
              {replaceError}
            </p>
          )}
          <div className="stack-actions">
            <BigButton testId="vocab-keep-old" tone="gray" label="Keep the old photo" disabled={saving} onClick={() => leaveReplace('keep')}>
              <span>保留旧照片</span>
            </BigButton>
            <BigButton testId="vocab-use-new" tone="green" label="Use the new photo" disabled={saving} onClick={() => void confirmNewPhoto()}>
              <span>使用新照片</span>
            </BigButton>
          </div>
        </div>
      )}

      {stage.name === 'card' && (
        <>
          {stage.note && <p className="vocab-note">{stage.note}</p>}
          <CardFace
            image={stage.card.image}
            zh={stage.card.zh}
            sv={swedishWithArticle(stage.card.article, stage.card.sv)}
            busyPlay={busyPlay}
            playError={playError}
            onPlay={(language) => {
              player.unlock();
              void playCard(stage.card, language);
            }}
          />
          <div className="stack-actions">
            <BigButton testId="vocab-back-library" tone="blue" label="My Vocabulary Cards" onClick={() => setStage({ name: 'library' })}>
              <span>我的词卡</span>
            </BigButton>
            <BigButton testId="vocab-delete" tone="gray" label="Delete card" onClick={() => setPendingDelete(stage.card.id)}>
              <span>删掉</span>
            </BigButton>
          </div>
        </>
      )}

      {stage.name === 'library' && (
        <VocabBrowser
          library={library}
          focusId={focusId}
          preset={preset}
          onCamera={() => {
            setFocusId(null);
            setStage({ name: 'capture' });
            cameraRef.current?.click();
          }}
        />
      )}

      {stage.name === 'error' && (
        <>
          <Mascot mood="oops" />
          <p className="warn" role="alert">
            {stage.zh}
            <br />
            {stage.sv}
          </p>
          <div className="stack-actions">
            {stage.image && (
              <BigButton testId="vocab-retry" tone="green" label="Try again" onClick={() => setStage({ name: 'preview', image: stage.image!, cardId: stage.cardId ?? crypto.randomUUID() })}>
                <span>再试一次</span>
              </BigButton>
            )}
            <BigButton testId="vocab-error-camera" tone="purple" label="Take another photo" onClick={() => cameraRef.current?.click()}>
              <span>换一张</span>
            </BigButton>
          </div>
        </>
      )}

      {pendingDelete && (
        <div className="vocab-confirm" role="alertdialog" aria-label="Delete card">
          <p>删掉这张词卡？</p>
          <p>Ta bort det här kortet?</p>
          <div className="split-actions">
            <BigButton testId="vocab-cancel-delete" tone="gray" label="Keep card" onClick={() => setPendingDelete(null)}>
              <span>留下</span>
            </BigButton>
            <BigButton testId="vocab-confirm-delete" tone="red" label="Delete card" onClick={() => void commitDelete()}>
              <span>删掉</span>
            </BigButton>
          </div>
        </div>
      )}
    </div>
  );
}

function stageImage(stage: Stage): PreparedImage | null {
  if (stage.name === 'preview' || stage.name === 'identifying' || stage.name === 'choose' || stage.name === 'draft' || stage.name === 'replace' || stage.name === 'blocked') return stage.image;
  if (stage.name === 'error') return stage.image;
  return null;
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

function Blocked({ outcome, onCamera, onUpload }: { outcome: 'person' | 'none'; onCamera: () => void; onUpload: () => void }) {
  const copy = identificationNotice(outcome);
  return (
    <>
      <Mascot mood="oops" />
      <p className="warn" role="alert" data-testid="vocab-blocked">
        {copy.zh}
        <br />
        {copy.sv}
      </p>
      <div className="stack-actions">
        <BigButton testId="vocab-blocked-camera" tone="purple" label="Take another photo" onClick={onCamera}>
          <span>再拍一张</span>
        </BigButton>
        <BigButton testId="vocab-blocked-upload" tone="orange" label="Upload another photo" onClick={onUpload}>
          <span>从相册选</span>
        </BigButton>
      </div>
    </>
  );
}

function DraftView({
  image,
  draft,
  banner,
  canSave,
  saving,
  saveError,
  playError,
  busyPlay,
  onDraft,
  onPlay,
  onSave,
  onRetake,
}: {
  image: PreparedImage;
  draft: Draft;
  banner: 'uncertain' | 'check' | null;
  canSave: boolean;
  saving: boolean;
  saveError: boolean;
  playError: string | null;
  busyPlay: 'zh' | 'sv' | null;
  onDraft: (draft: Draft) => void;
  onPlay: (language: 'zh' | 'sv') => void;
  onSave: () => void;
  onRetake: () => void;
}) {
  const notice = banner === 'uncertain' ? identificationNotice('uncertain') : banner === 'check' ? { zh: '翻译还不确定。请改一改，确认后再保存。', sv: 'Översättningen är osäker. Rätta den innan du sparar.' } : null;
  return (
    <>
      <img className="vocab-preview" src={image.previewUrl} alt="" />
      {notice && <p className="vocab-note">{notice.zh}</p>}
      <form
        className="vocab-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label>
          中文
          <input data-testid="vocab-zh" value={draft.zh} maxLength={40} onChange={(event) => onDraft({ ...draft, zh: event.target.value, translationUncertain: false })} />
        </label>
        <label>
          Svenska
          <input data-testid="vocab-sv" value={draft.sv} maxLength={40} onChange={(event) => onDraft({ ...draft, sv: event.target.value, translationUncertain: false })} />
        </label>
        <label>
          en / ett
          <select
            data-testid="vocab-article"
            value={draft.article ?? 'none'}
            onChange={(event) => onDraft({ ...draft, article: event.target.value === 'none' ? null : (event.target.value as SwedishArticle) })}
          >
            <option value="none">没有冠词</option>
            <option value="en">en</option>
            <option value="ett">ett</option>
          </select>
        </label>
      </form>
      <CardPlay zh={draft.zh || '中文'} sv={swedishWithArticle(draft.article, draft.sv) || 'Svenska'} busyPlay={busyPlay} playError={playError} onPlay={onPlay} />
      {saveError && <p className="warn">没保存上。请再试一次。</p>}
      <div className="stack-actions">
        <BigButton testId="vocab-save" tone="green" label="Save vocabulary card" disabled={!canSave || saving} onClick={onSave}>
          <span>{saving ? '…' : '保存词卡'}</span>
        </BigButton>
        <BigButton testId="vocab-draft-retake" tone="gray" label="Choose another photo" onClick={onRetake}>
          <span>换一张</span>
        </BigButton>
      </div>
    </>
  );
}

function BlobImage({ blob, className }: { blob: Blob; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!url) return null;
  return <img className={className} src={url} alt="" />;
}

function CardFace({
  image,
  zh,
  sv,
  busyPlay,
  playError,
  onPlay,
}: {
  image: Blob;
  zh: string;
  sv: string;
  busyPlay: 'zh' | 'sv' | null;
  playError: string | null;
  onPlay: (language: 'zh' | 'sv') => void;
}) {
  return (
    <>
      <BlobImage blob={image} className="vocab-preview" />
      <div className="translation-card vocab-card" data-testid="vocab-card">
        <p>{zh}</p>
        <div className="divider" />
        <p className="translation">{sv}</p>
      </div>
      <CardPlay zh="中文" sv="Svenska" busyPlay={busyPlay} playError={playError} onPlay={onPlay} />
    </>
  );
}

function CardPlay({
  zh,
  sv,
  busyPlay,
  playError,
  onPlay,
}: {
  zh: string;
  sv: string;
  busyPlay: 'zh' | 'sv' | null;
  playError: string | null;
  onPlay: (language: 'zh' | 'sv') => void;
}) {
  return (
    <>
      <div className="split-actions vocab-play">
        <BigButton testId="vocab-play-zh" tone="red" label="Play Chinese" disabled={busyPlay !== null} onClick={() => onPlay('zh')}>
          <Icon name="sound" />
          <span>{zh}</span>
        </BigButton>
        <BigButton testId="vocab-play-sv" tone="blue" label="Play Swedish" disabled={busyPlay !== null} onClick={() => onPlay('sv')}>
          <Icon name="sound" />
          <span>{sv}</span>
        </BigButton>
      </div>
      {playError && (
        <p className="warn" role="alert">
          {playError}
        </p>
      )}
    </>
  );
}
