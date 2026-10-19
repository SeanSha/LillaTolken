import { useEffect, useState } from 'react';
import { MOCK_SCENARIOS, findMockScenario, type ProviderPreset } from '@kt/shared';
import type { DialogueSnapshot, Send } from '../dialogue/selectors';
import { inspectMicEnvironment } from '../audio/recorder';
import { parsePreset, rememberPreset } from '../services/presetPreference';
import { getHealth, logger, mockScript, refreshHealth } from '../services/runtime';
import { settings, useSettings, type MicMode } from '../services/settings';

type Props = { snap: DialogueSnapshot; send: Send; onClose: () => void };

/** Developer-only settings. Presets change ONLY while idle; a running task keeps its frozen preset. */
export function DevPanel({ snap, send, onClose }: Props) {
  const s = useSettings();
  const [, force] = useState(0);
  const idle = snap.matches('idle');
  const preset = snap.context.preset;
  const env = inspectMicEnvironment();
  const health = getHealth();
  const scenario = findMockScenario(s.mockScenarioId);

  useEffect(() => {
    void refreshHealth().then(() => force((n) => n + 1));
  }, []);

  const choosePreset = (next: ProviderPreset) => {
    if (!idle) return;
    if (next === 'cloud' && !s.cloudAcknowledged) return;
    send({ type: 'SET_PRESET', preset: next });
    rememberPreset(next);
  };
  const cloudLinkWaiting = parsePreset(new URLSearchParams(window.location.search).get('preset')) === 'cloud' && !s.cloudAcknowledged;

  return (
    <div className="dev-panel" role="dialog" aria-label="Developer settings">
      <div className="dev-header">
        <strong>⚙ Developer / 开发者设置</strong>
        <button type="button" className="dev-close" onClick={onClose} aria-label="Close">
          ✖
        </button>
      </div>

      <section>
        <h3>Provider preset {idle ? '' : '(locked: task running)'}</h3>
        {(['mock', 'cloud', 'local'] as const).map((p) => {
          const info = health?.presets[p];
          const unavailable = health ? !info?.available : p !== 'mock';
          const blockedByAck = p === 'cloud' && !s.cloudAcknowledged;
          return (
            <label key={p} className={`radio${unavailable ? ' disabled' : ''}`}>
              <input
                type="radio"
                name="preset"
                data-testid={`preset-${p}`}
                checked={preset === p}
                disabled={!idle || unavailable || blockedByAck}
                onChange={() => choosePreset(p)}
              />
              <span>
                <b>{p}</b> {info ? `· ${info.modelTag}` : ''}
                {unavailable && <em> — {info?.reason ?? (health ? 'unavailable' : 'server not reachable')}</em>}
              </span>
            </label>
          );
        })}
        <p className="hint">选择会留在这台设备上，刷新后仍然有效。固定地址：在网址后加 ?preset=local 或 ?preset=cloud。</p>
        {cloudLinkWaiting && <p className="hint">这个地址固定为 cloud。勾选下面的确认后就会切过去，只需勾一次。</p>}
        <label className="check">
          <input
            type="checkbox"
            data-testid="cloud-ack"
            checked={s.cloudAcknowledged}
            onChange={(e) => {
              const checked = e.target.checked;
              settings.set({ cloudAcknowledged: checked });
              if (checked && idle && parsePreset(new URLSearchParams(window.location.search).get('preset')) === 'cloud') {
                send({ type: 'SET_PRESET', preset: 'cloud' });
                rememberPreset('cloud');
              }
            }}
          />
          <span>
            Cloud: 我确认只使用<b>成人或合成</b>语音,不含真实儿童数据 / Endast vuxna eller syntetiska röster. Inga riktiga barn.
          </span>
        </label>
      </section>

      <section>
        <h3>Mock scenario (scripted utterances)</h3>
        <select
          data-testid="scenario-select"
          value={s.mockScenarioId}
          onChange={(e) => {
            settings.set({ mockScenarioId: e.target.value });
            mockScript.select(e.target.value);
          }}
        >
          {MOCK_SCENARIOS.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.label}
            </option>
          ))}
        </select>
        {scenario && (
          <p className="hint">
            方向 {scenario.direction === 'ZH_TO_SV' ? '中→瑞' : '瑞→中'} · {scenario.hint}
            <br />
            脚本: {scenario.utterances.map((u) => `「${u}」`).join(' ')}
          </p>
        )}
        <label>
          Microphone (mock preset):{' '}
          <select value={s.micMode} onChange={(e) => settings.set({ micMode: e.target.value as MicMode })}>
            <option value="auto">auto — simulated (no mic needed)</option>
            <option value="real">real mic + scripted text</option>
          </select>
        </label>
      </section>

      <section>
        <h3>Evaluation label</h3>
        <input
          type="text"
          placeholder="scenarioId (non-identifying), e.g. A01"
          maxLength={40}
          value={s.scenarioId}
          onChange={(e) => settings.set({ scenarioId: e.target.value.replace(/[^A-Za-z0-9_.-]/g, '') })}
        />
      </section>

      <section>
        <h3>Session</h3>
        <p className="hint">
          Previous delivered message in memory: <b>{snap.context.lastDelivered ? 'yes' : 'no'}</b> · events logged this page:{' '}
          {logger.recorded.length}
        </p>
        <div className="dev-actions">
          <button type="button" data-testid="end-session" onClick={() => send({ type: 'END_SESSION' })}>
            End session (clear memory)
          </button>
          <a href="/api/events/export" download="kidstranslator-events.csv" data-testid="export-csv" onClick={() => void logger.flush()}>
            Download events CSV
          </a>
        </div>
      </section>

      <section>
        <h3>Environment</h3>
        <ul className="hint">
          <li>Secure context (HTTPS): {String(env.secureContext)}</li>
          <li>getUserMedia + MediaRecorder: {String(env.supported)}</li>
          <li>Recorder MIME: {env.mimeType ?? 'browser default'}</li>
          <li>Server: {health ? `ok · v${health.version} · prompt-memory ${health.promptMemory ? 'on' : 'off'}` : 'NOT reachable'}</li>
        </ul>
      </section>
    </div>
  );
}
