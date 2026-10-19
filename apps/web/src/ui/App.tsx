import { useEffect, useState } from 'react';
import { useActor } from '@xstate/react';
import { otherDirection } from '@kt/shared';
import { dialogueMachine, logger, mockScript, refreshHealth } from '../services/runtime';
import { screenOf, type Screen } from '../dialogue/selectors';
import { rememberPreset, startingPreset } from '../services/presetPreference';
import { settings } from '../services/settings';
import { DevPanel } from './DevPanel';
import {
  AsrEmptyScreen,
  BusyScreen,
  ErrorScreen,
  FallbackScreen,
  HomeScreen,
  QuestionScreen,
  RecordingScreen,
  ResultScreen,
  SegmentDecisionScreen,
  SwitchScreen,
  directionFlags,
} from './screens';

export function App() {
  const [presetAtStart] = useState(startingPreset);
  const [snap, send] = useActor(dialogueMachine, { input: { preset: presetAtStart } });
  // A cloud bookmark still needs the adult confirmation the first time; open settings so that box is visible.
  const [devOpen, setDevOpen] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('preset');
    return requested === 'cloud' && !settings.get().cloudAcknowledged;
  });
  const screen: Screen = screenOf(snap);
  const task = snap.context.task;
  const taskActive = task !== null && screen !== 'switch';
  const delivered = snap.matches({ task: { result: 'delivered' } });
  const showTaskControls = taskActive && !delivered;

  useEffect(() => {
    void refreshHealth();
    mockScript.select(settings.get().mockScenarioId);
    // Keep a remembered mode in the address bar. Don't overwrite ?preset=cloud while it is still waiting on the acknowledgement.
    const fromUrl = new URLSearchParams(window.location.search).get('preset');
    if (!(fromUrl && fromUrl !== presetAtStart) && (presetAtStart !== 'mock' || fromUrl)) rememberPreset(presetAtStart);
    const flush = () => void logger.flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [presetAtStart]);

  const props = { snap, send };

  return (
    <div className={`app screen-${screen}`}>
      <header className="topbar">
        <button type="button" className={`top-action${showTaskControls ? '' : ' is-hidden'}`} data-testid="cancel" aria-label="Cancel" tabIndex={showTaskControls ? 0 : -1} onClick={() => send({ type: 'CANCEL' })}>
          ×
        </button>

        <div className="route" aria-live="polite">
          {task ? <span data-testid="direction-badge">{directionFlags(task.direction)}</span> : null}
          {snap.context.preset !== 'mock' && <span className="preset-chip">{snap.context.preset}</span>}
        </div>

        <div className="top-actions">
          <button
            type="button"
            className={`top-action${showTaskControls ? '' : ' is-hidden'}`}
            data-testid="switch-direction"
            aria-label="Switch direction"
            tabIndex={showTaskControls ? 0 : -1}
            onClick={() => task && send({ type: 'SWITCH_REQUESTED', direction: otherDirection(task.direction) })}
          >
            ⇄
          </button>
          <button type="button" className="settings" data-testid="open-dev" aria-label="Developer settings" onClick={() => setDevOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      <main className="main" data-state={JSON.stringify(snap.value)}>
        {screen === 'home' && <HomeScreen {...props} />}
        {screen === 'recording' && <RecordingScreen {...props} />}
        {screen === 'segmentDecision' && <SegmentDecisionScreen {...props} />}
        {screen === 'busy' && <BusyScreen {...props} />}
        {screen === 'clarify' && <QuestionScreen {...props} kind="clarify" />}
        {screen === 'confirm' && <QuestionScreen {...props} kind="confirm" />}
        {screen === 'result' && <ResultScreen {...props} />}
        {screen === 'switch' && <SwitchScreen {...props} />}
        {screen === 'error' && <ErrorScreen {...props} />}
        {screen === 'fallback' && <FallbackScreen {...props} />}
        {screen === 'asrEmpty' && <AsrEmptyScreen {...props} />}
        {/* Inside the scroll area: adults can scroll down to it, and it never steals height from the child's buttons. */}
        <AdultInfo snap={snap} screen={screen} />
      </main>

      {devOpen && <DevPanel snap={snap} send={send} onClose={() => setDevOpen(false)} />}
    </div>
  );
}

/** Small adult-readable panel: transcript so far and clarification budget (UI only, never logged). */
function AdultInfo({ snap, screen }: { snap: ReturnType<typeof useActor<typeof dialogueMachine>>[0]; screen: Screen }) {
  const task = snap.context.task;
  if (!task || screen === 'home' || screen === 'result' || screen === 'switch') return null;
  const parts = task.dialogueInputs.flatMap((d) => d.textParts);
  return (
    <details className="adult-info">
      <summary>👁 For adults / För vuxna</summary>
      <ul>
        <li>
          {task.direction === 'ZH_TO_SV' ? '中→瑞' : 'Sv→Zh'} · clarifications {task.clarificationCount}/3 · corrections {task.correctionCount}/2 · segments waiting {task.pendingSegments}
        </li>
        {parts.length > 0 && <li data-testid="adult-transcript">Heard: {parts.map((p) => `「${p}」`).join(' ')}</li>}
        {task.currentQuestion && <li>Question: {task.currentQuestion}</li>}
        {task.proposedMeaning && <li>Proposed meaning: {task.proposedMeaning}</li>}
      </ul>
    </details>
  );
}
