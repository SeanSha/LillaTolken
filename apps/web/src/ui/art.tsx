// Vector art from the approved Figma Make design (design/figma-make): the mascot and the line icons.
// Pure presentation; no behaviour lives here.

export type IconName = 'mic' | 'stop' | 'sound' | 'plus' | 'replay' | 'retry' | 'camera' | 'cards' | 'home';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  sound: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10H4Z" />
      <path d="M16 9c2 2 2 4 0 6M19 6c4 4 4 8 0 12" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  replay: (
    <>
      <path d="M4 9a8 8 0 1 1 1 7" />
      <path d="M4 4v5h5" />
    </>
  ),
  retry: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  cards: (
    <>
      <rect x="6" y="7" width="14" height="12" rx="2" />
      <path d="M4 5h12" />
    </>
  ),
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M7 10.5V20h10v-9.5" />
    </>
  ),
};

/** Open-path icons are drawn as strokes only (filling an open path produces a blob). */
const OUTLINE = new Set<IconName>(['plus', 'replay', 'retry', 'camera', 'cards', 'home']);

/** Five-point star, tip up. `r` is the outer radius. */
function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const outer = ((-90 + i * 72) * Math.PI) / 180;
    const inner = outer + Math.PI / 5;
    pts.push(`${cx + r * Math.cos(outer)},${cy + r * Math.sin(outer)}`);
    pts.push(`${cx + r * 0.38 * Math.cos(inner)},${cy + r * 0.38 * Math.sin(inner)}`);
  }
  return pts.join(' ');
}

function Flag({ lang }: { lang: 'zh' | 'sv' }) {
  return lang === 'zh' ? (
    <svg viewBox="0 0 30 20">
      <rect width="30" height="20" rx="2" fill="#DE2910" />
      <polygon fill="#FFDE00" points={starPoints(5.5, 5.2, 2.7)} />
      <polygon fill="#FFDE00" points={starPoints(10.2, 2.1, 1)} />
      <polygon fill="#FFDE00" points={starPoints(12.2, 4.2, 1)} />
      <polygon fill="#FFDE00" points={starPoints(12.2, 7.2, 1)} />
      <polygon fill="#FFDE00" points={starPoints(10.2, 9.2, 1)} />
    </svg>
  ) : (
    <svg viewBox="0 0 32 22">
      <rect width="32" height="22" rx="2" fill="#006AA7" />
      <rect x="9" width="5" height="22" fill="#FECC00" />
      <rect y="8.5" width="32" height="5" fill="#FECC00" />
    </svg>
  );
}

/** Source flag → target flag. `banner` is the large direction shown above the screen; the default fits a button. */
export function LanguageMark({ from, size = 'button' }: { from: 'zh' | 'sv'; size?: 'button' | 'banner' }) {
  const to = from === 'zh' ? 'sv' : 'zh';
  return (
    <span className={`lang-route${size === 'banner' ? ' lang-route--banner' : ''}`} aria-hidden="true">
      <Flag lang={from} />
      <span className="lang-route-arrow">→</span>
      <Flag lang={to} />
    </span>
  );
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className={`icon${OUTLINE.has(name) ? ' icon--line' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

export type Mood = 'happy' | 'listen' | 'think' | 'oops';

export function Mascot({ mood = 'happy' }: { mood?: Mood }) {
  return (
    <div className={`mascot mascot--${mood}`} aria-hidden="true">
      <svg viewBox="0 0 180 154">
        <path className="ear" d="M39 47 23 20c-3-6 5-12 11-8l29 20M141 47l16-27c3-6-5-12-11-8l-29 20" />
        <path className="body" d="M39 39c25-24 77-24 102 0 21 21 20 68-2 88-24 23-74 23-98 0-22-20-23-67-2-88Z" />
        <circle className="cheek" cx="48" cy="90" r="10" />
        <circle className="cheek" cx="132" cy="90" r="10" />
        <circle className="eye" cx="66" cy="75" r="5" />
        <circle className="eye" cx="114" cy="75" r="5" />
        {mood === 'oops' ? <path className="face" d="M78 108c7-7 17-7 24 0" /> : <path className="face" d="M76 99c7 12 21 12 28 0" />}
        {mood === 'listen' && <path className="wave" d="M150 60c10 8 10 22 0 30M162 50c17 15 17 37 0 52" />}
        {mood === 'think' && (
          <>
            <circle className="thought" cx="149" cy="28" r="6" />
            <circle className="thought" cx="166" cy="13" r="10" />
          </>
        )}
      </svg>
    </div>
  );
}
