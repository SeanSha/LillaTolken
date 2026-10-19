import { LIMITS, otherDirection, type Direction } from '@kt/shared';
import { busyStage, type DialogueSnapshot, type Send } from '../dialogue/selectors';
import { inspectMicEnvironment } from '../audio/recorder';
import { confirmationPrompt } from '../dialogue/text';
import { player } from '../services/runtime';
import { useSettings } from '../services/settings';
import { Icon, Mascot } from './art';
import { BigButton } from './BigButton';
import { useCountdown, usePlayback } from './hooks';

type ScreenProps = { snap: DialogueSnapshot; send: Send };

const FLAG: Record<'zh' | 'sv', string> = { zh: '🇨🇳', sv: '🇸🇪' };
export const directionFlags = (d: Direction) => (d === 'ZH_TO_SV' ? `${FLAG.zh}➜${FLAG.sv}` : `${FLAG.sv}➜${FLAG.zh}`);

// ---------------------------------------------------------------- shared bits
const FLAGS = (from: 'zh' | 'sv') => (
  <span className="flags">
    {FLAG[from]} <span>→</span> {FLAG[from === 'zh' ? 'sv' : 'zh']}
  </span>
);

function Titles({ zh, sv, compact = false }: { zh: string; sv: string; compact?: boolean }) {
  return (
    <div className="titles">
      <div className={`title${compact ? ' compact' : ''}`}>{zh}</div>
      <div className="subtitle">{sv}</div>
    </div>
  );
}

/** Segment progress: `done` finished segments, the next one lit while recording. Always at least 3 dots. */
function ProgressDots({ done, recording }: { done: number; recording: boolean }) {
  const total = Math.max(3, done + (recording ? 1 : 0));
  return (
    <div className="progress-dots" aria-label={`${done} segments`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < done ? 'done' : recording && i === done ? 'active' : ''} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Home
export function HomeScreen({ snap, send }: ScreenProps) {
  const settings = useSettings();
  const preset = snap.context.preset;
  const env = inspectMicEnvironment();
  const needsRealMic = preset !== 'mock' || settings.micMode === 'real';
  const start = (direction: Direction) => {
    player.unlock(); // iOS: unlock audio playback inside the tap
    send({ type: 'START_TASK', direction });
  };
  return (
    <div className="screen home">
      <div className="hero-copy">
        <div className="eyebrow">小翻译 · Lilla Tolken</div>
        <div className="title">你想说什么?</div>
        <div className="subtitle">Vad vill du säga?</div>
      </div>
      <Mascot mood="happy" />
      <div className="home-actions">
        <BigButton testId="start-zh-sv" tone="red" label="中文 → Svenska" onClick={() => start('ZH_TO_SV')}>
          {FLAGS('zh')}
          <span className="action-label">
            <Icon name="mic" />
            说中文
          </span>
          <small>Prata kinesiska</small>
        </BigButton>
        <BigButton testId="start-sv-zh" tone="blue" label="Svenska → 中文" onClick={() => start('SV_TO_ZH')}>
          {FLAGS('sv')}
          <span className="action-label">
            <Icon name="mic" />
            说瑞典语
          </span>
          <small>Prata svenska</small>
        </BigButton>
      </div>
      {needsRealMic && !env.secureContext && (
        <p className="warn" role="alert">
          ⚠️ 麦克风需要 HTTPS(或 localhost)。Mikrofon kräver HTTPS.
        </p>
      )}
      {needsRealMic && !env.supported && (
        <p className="warn" role="alert">
          ⚠️ 此浏览器不支持录音(MediaRecorder)。
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Recording
export function RecordingScreen({ snap, send }: ScreenProps) {
  const task = snap.context.task;
  const listening = snap.matches({ task: { recording: 'listening' } });
  const prompting = snap.matches({ task: { recording: 'prompting' } });
  const remaining = useCountdown(snap.context.segmentStartedAt, listening);
  const purpose = task?.inputPurpose ?? 'INITIAL';
  const segmentNo = (task?.pendingSegments ?? 0) + 1;
  const fraction = listening ? remaining / LIMITS.segmentSeconds : 1;
  const R = 53;
  const circumference = 2 * Math.PI * R;
  const urgent = listening && remaining <= 5;

  return (
    <div className="screen recording">
      <div className="badge-row">
        {purpose === 'CLARIFICATION' && <span className="mini-badge">❓</span>}
        {purpose === 'CORRECTION' && <span className="mini-badge">✏️</span>}
        <ProgressDots done={segmentNo - 1} recording />
      </div>

      {listening ? <Titles compact zh="我在听" sv="Jag lyssnar" /> : prompting ? <Titles compact zh="听一听" sv="Lyssna" /> : <Titles compact zh="稍等" sv="Vänta" />}

      <div className={`timer${urgent ? ' timer--alert' : ''}`} data-testid="countdown">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={R} />
          <circle className="timer-progress" cx="60" cy="60" r={R} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} />
        </svg>
        <strong data-testid="countdown-number">{listening ? Math.ceil(remaining) : prompting ? '🔈' : '…'}</strong>
      </div>

      <Mascot mood="listen" />

      {listening ? (
        <BigButton testId="stop" tone="red" pulse className="single-action" label="Stop" onClick={() => send({ type: 'STOP_SEGMENT' })}>
          <Icon name="stop" />
          <span>说完这一段</span>
        </BigButton>
      ) : prompting ? (
        <BigButton testId="skip-prompt" tone="green" className="single-action" label="Start speaking" onClick={() => send({ type: 'SKIP_PROMPT' })}>
          <Icon name="mic" />
          <span>开始说</span>
        </BigButton>
      ) : (
        <BigButton tone="gray" disabled className="single-action" label="Wait" onClick={() => undefined}>
          <span>…</span>
        </BigButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Continue / Finished
export function SegmentDecisionScreen({ snap, send }: ScreenProps) {
  const count = snap.context.task?.pendingSegments ?? 0;
  return (
    <div className="screen decision">
      <ProgressDots done={count} recording={false} />
      <Mascot />
      <Titles zh="还要说吗?" sv="Vill du säga mer?" />
      <div className="split-actions">
        <BigButton testId="continue" tone="blue" label="Continue" onClick={() => send({ type: 'CONTINUE_SPEAKING' })}>
          <Icon name="plus" />
          <span>继续说</span>
        </BigButton>
        <BigButton testId="finish" tone="green" label="Finished" onClick={() => send({ type: 'FINISH_INPUT' })}>
          <span className="big-symbol">✓</span>
          <span>说完了</span>
        </BigButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Busy
const BUSY_COPY: Record<ReturnType<typeof busyStage>, { zh: string; sv: string }> = {
  asr: { zh: '听一听', sv: 'Lyssnar' },
  interpret: { zh: '想一想', sv: 'Förstår' },
  translate: { zh: '翻译中', sv: 'Översätter' },
  tts: { zh: '准备声音', sv: 'Gör rösten klar' },
};
const STEPS: Array<{ stage: ReturnType<typeof busyStage>; label: string }> = [
  { stage: 'asr', label: '听' },
  { stage: 'interpret', label: '懂' },
  { stage: 'translate', label: '译' },
  { stage: 'tts', label: '说' },
];

export function BusyScreen({ snap }: ScreenProps) {
  const stage = busyStage(snap);
  const index = STEPS.findIndex((s) => s.stage === stage);
  const copy = BUSY_COPY[stage];
  return (
    <div className="screen busy" role="status">
      <div className="thinking-orbit">
        <Mascot mood="think" />
        <i />
        <i />
        <i />
      </div>
      <div className="titles" data-testid="busy-label">
        <div className="title">{copy.zh}</div>
        <div className="subtitle">{copy.sv}…</div>
      </div>
      <div className="stepper" aria-hidden="true">
        {STEPS.map((step, i) => (
          <span key={step.stage} className={i <= index ? 'active' : ''}>
            {i < index ? '✓' : step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Clarify / Confirm
export function QuestionScreen({ snap, send, kind }: ScreenProps & { kind: 'clarify' | 'confirm' }) {
  const task = snap.context.task;
  const ready = snap.context.audioStatus === 'ready';
  const failed = snap.context.audioStatus === 'failed';
  const playback = usePlayback('prompt', ready, true);
  const text = kind === 'clarify' ? task?.currentQuestion : task?.proposedMeaning;
  const adultText = kind === 'confirm' ? confirmationPrompt(text ?? '') : text;

  const replay = failed ? (
    <BigButton testId="retry-audio" tone="orange" label="Retry audio" onClick={() => send({ type: 'RETRY' })}>
      <Icon name="retry" />
      <span>重试声音</span>
    </BigButton>
  ) : kind === 'confirm' ? (
    <button type="button" className={`sound-bubble${playback.blocked || playback.playing ? ' pulse' : ''}`} data-testid="replay" aria-label="Replay" disabled={!ready} onClick={playback.play}>
      <Icon name="sound" />
    </button>
  ) : null;

  return (
    <div className="screen question">
      <div className="badge">{kind === 'confirm' ? '听听看 · Lyssna' : '一个小问题 · En liten fråga'}</div>
      <Mascot mood={kind === 'confirm' ? 'happy' : 'listen'} />
      {kind === 'confirm' ? <Titles zh="是这个意思吗?" sv="Menar du det?" /> : <Titles zh="再说一点点" sv="Berätta lite mer" />}
      <p className="adult-note" data-testid="question-text">
        {adultText}
      </p>
      {kind === 'clarify' ? (
        <div className="stack-actions">
          {failed ? (
            replay
          ) : (
            <BigButton testId="replay" tone="purple" pulse={playback.blocked || playback.playing} label="Replay" disabled={!ready} onClick={playback.play}>
              <Icon name="sound" />
              <span>再听一次</span>
            </BigButton>
          )}
          <BigButton testId="answer" tone="red" label="Answer" onClick={() => send({ type: 'START_ANSWER' })}>
            <Icon name="mic" />
            <span>回答</span>
          </BigButton>
        </div>
      ) : (
        <>
          {replay}
          <div className="split-actions">
            <BigButton testId="confirm-yes" tone="green" label="Yes" onClick={() => send({ type: 'CONFIRM_YES' })}>
              <span className="big-symbol">✓</span>
              <span>对!</span>
            </BigButton>
            <BigButton testId="confirm-no" tone="red" label="No" onClick={() => send({ type: 'CONFIRM_NO' })}>
              <span className="big-symbol">×</span>
              <span>不对</span>
            </BigButton>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Result
export function ResultScreen({ snap, send }: ScreenProps) {
  const task = snap.context.task;
  const pending = snap.matches({ task: { result: 'pending' } });
  const ttsFailed = snap.matches({ task: { result: 'ttsFailed' } });
  const delivered = snap.matches({ task: { result: 'delivered' } });
  const ready = snap.context.audioStatus === 'ready';
  // Auto-plays once when audio becomes ready; Safari may block it, so Play is always visible.
  // `onEnded` reads the latest `pending`, so replays after delivery never re-send the event.
  const active = usePlayback('result', ready && pending, true, () => {
    if (pending) send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
  });
  if (!task) return null;
  const zhToSv = task.direction === 'ZH_TO_SV';

  return (
    <div className="screen result">
      {delivered ? (
        <div className="delivered">
          <span>✓</span> 已送达 · Klart!
        </div>
      ) : ttsFailed ? (
        <div className="badge badge--warn">声音没准备好 · Ljudet misslyckades</div>
      ) : (
        <div className="badge">听翻译 · Lyssna</div>
      )}

      {!ttsFailed && (
        <button
          type="button"
          data-testid="play"
          className={`play-orb${pending && (active.blocked || !active.playing) ? ' pulse' : ''}`}
          aria-label={delivered ? 'Replay' : 'Play'}
          disabled={!ready}
          onClick={active.play}
        >
          <Icon name={active.playing ? 'sound' : delivered ? 'replay' : 'sound'} />
        </button>
      )}

      <div className="translation-card">
        <div data-testid="source-text">
          <small>{zhToSv ? '🇨🇳 你的意思' : '🇸🇪 Igenkänd text'}</small>
          <p lang={zhToSv ? 'zh' : 'sv'}>{zhToSv ? task.confirmedMeaning : task.sourceText}</p>
        </div>
        <div className="divider" />
        <div data-testid="translated-text">
          <small>{zhToSv ? '🇸🇪 Svenska' : '🇨🇳 中文'}</small>
          <p lang={zhToSv ? 'sv' : 'zh'} className="translation">
            {task.translatedText}
          </p>
        </div>
      </div>

      {ttsFailed && (
        <div className="stack-actions">
          <BigButton testId="retry-audio" tone="orange" label="Retry audio" onClick={() => send({ type: 'RETRY' })}>
            <Icon name="retry" />
            <span>重试声音</span>
          </BigButton>
          <BigButton testId="accept-text-only" tone="gray" label="Text only" onClick={() => send({ type: 'DELIVERY_FINISHED', mode: 'text_only' })}>
            <span>只看文字</span>
          </BigButton>
        </div>
      )}
      {pending && active.failed && (
        <BigButton testId="regenerate" tone="orange" label="Retry audio" onClick={() => send({ type: 'RETRY' })}>
          <Icon name="retry" />
          <span>重试声音</span>
        </BigButton>
      )}

      {delivered && (
        <div className="result-actions">
          {/* Primary (larger, left): record again in the same direction. Secondary: back to the start screen. */}
          <BigButton testId="re-record" tone="red" label="Re-record" onClick={() => send({ type: 'START_TASK', direction: task.direction })}>
            <Icon name="mic" />
            <span>再说一次</span>
          </BigButton>
          <BigButton testId="new-turn" tone="gray" label="New turn" onClick={() => send({ type: 'NEW_TURN' })}>
            <Icon name="plus" />
            <span>新一轮</span>
          </BigButton>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Direction switch confirmation
export function SwitchScreen({ snap, send }: ScreenProps) {
  const target = snap.context.pendingDirection ?? (snap.context.task ? otherDirection(snap.context.task.direction) : 'SV_TO_ZH');
  const [from, to] = target === 'ZH_TO_SV' ? [FLAG.zh, FLAG.sv] : [FLAG.sv, FLAG.zh];
  return (
    <div className="screen switch">
      <div className="switch-symbol" aria-hidden="true">
        ⇄
      </div>
      <Titles zh="换个方向?" sv="Byta håll?" />
      <div className="direction-preview" aria-hidden="true">
        <span>{from}</span>
        <b>→</b>
        <span>{to}</span>
      </div>
      <div className="stack-actions">
        <BigButton testId="switch-yes" tone="blue" label="Switch" onClick={() => send({ type: 'SWITCH_YES' })}>
          <span>切换方向</span>
        </BigButton>
        <BigButton testId="switch-no" tone="gray" label="Keep going" onClick={() => send({ type: 'SWITCH_NO' })}>
          <span>继续当前方向</span>
        </BigButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Error / fallback / empty ASR
const ERROR_HINT: Record<string, string> = {
  PERMISSION_DENIED: '麦克风被拒绝。请在 Safari 允许麦克风,并使用 HTTPS。 Mikrofon nekad.',
  RECORDER: '录音失败。 Inspelningen misslyckades.',
  NETWORK: '网络错误。 Nätverksfel.',
  TIMEOUT: '请求超时。 Tidsgräns.',
  INVALID_MODEL_OUTPUT: '模型返回了无效结果。 Ogiltigt modellsvar.',
  NOT_CONFIGURED: '该服务未配置(例如缺少 API key)。 Tjänsten saknar konfiguration.',
};

function MessageScreen({ symbol, title, note, noteTestId, className, children }: { symbol: string; title: { zh: string; sv: string }; note: React.ReactNode; noteTestId: string; className: string; children: React.ReactNode }) {
  return (
    <div className={`screen message-screen ${className}`}>
      <div className="message-symbol" aria-hidden="true">
        {symbol}
      </div>
      <Mascot mood="oops" />
      <Titles zh={title.zh} sv={title.sv} />
      <p className="adult-note" data-testid={noteTestId}>
        {note}
      </p>
      <div className="stack-actions">{children}</div>
    </div>
  );
}

export function ErrorScreen({ snap, send }: ScreenProps) {
  const error = snap.context.error;
  return (
    <MessageScreen
      className="error"
      symbol="!"
      title={{ zh: '出了点小问题', sv: 'Något gick fel' }}
      noteTestId="error-text"
      note={
        <>
          {error ? `${error.stage} · ${error.category}` : ''}
          <br />
          {error ? (ERROR_HINT[error.category] ?? '') : ''}
        </>
      }
    >
      <BigButton testId="retry" tone="orange" label="Retry" onClick={() => send({ type: 'RETRY' })}>
        <Icon name="retry" />
        <span>再试一次</span>
      </BigButton>
      <BigButton testId="cancel-error" tone="gray" label="Cancel" onClick={() => send({ type: 'CANCEL' })}>
        <span>取消</span>
      </BigButton>
    </MessageScreen>
  );
}

const FALLBACK_TEXT: Record<string, string> = {
  CLARIFICATION_LIMIT: '已问满 3 个问题,仍不清楚。 Fortfarande oklart efter 3 frågor.',
  UNRESOLVED: '无法确定意思。 Kunde inte tolka.',
  CORRECTION_LIMIT: '已纠正 2 次,仍未确认。 Två rättelser räckte inte.',
  ASR_EMPTY_LIMIT: '多次没有听到声音。 Hörde inget flera gånger.',
};

export function FallbackScreen({ snap, send }: ScreenProps) {
  return (
    <MessageScreen className="fallback" symbol="?" title={{ zh: '我们换个办法吧', sv: 'Vi provar något annat' }} noteTestId="fallback-text" note={FALLBACK_TEXT[snap.context.fallbackReason ?? 'UNRESOLVED']}>
      <BigButton testId="restart" tone="orange" label="Restart" onClick={() => send({ type: 'RESTART' })}>
        <Icon name="retry" />
        <span>重新开始</span>
      </BigButton>
      <BigButton testId="cancel-fallback" tone="gray" label="Cancel" onClick={() => send({ type: 'CANCEL' })}>
        <span>取消</span>
      </BigButton>
    </MessageScreen>
  );
}

export function AsrEmptyScreen({ snap, send }: ScreenProps) {
  const left = LIMITS.asrRetries - (snap.context.task?.asrRetryCount ?? 0);
  return (
    <MessageScreen className="asr-empty" symbol="👂" title={{ zh: '没有听清楚', sv: 'Hörde inget' }} noteTestId="asr-empty-text" note={`没听清,请再说一遍 · försök kvar: ${left}`}>
      <BigButton testId="record-again" tone="red" pulse label="Again" onClick={() => send({ type: 'RETRY' })}>
        <Icon name="mic" />
        <span>再说一遍</span>
      </BigButton>
    </MessageScreen>
  );
}
