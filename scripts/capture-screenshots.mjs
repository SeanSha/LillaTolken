/**
 * Capture phone-sized UI screenshots for both translation directions.
 * Requires the Vite+server stack at https://localhost:5173 with mock available.
 *
 * Usage: node scripts/capture-screenshots.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/screenshots');
const BASE = process.env.KT_URL ?? 'https://localhost:5173';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTestId(page, testId, { timeout = 20000, visible = true } = {}) {
  const sel = `[data-testid="${testId}"]`;
  await page.waitForSelector(sel, { timeout, visible });
  return sel;
}

async function clickTestId(page, testId) {
  const sel = await waitForTestId(page, testId);
  await page.click(sel);
}

async function waitState(page, needle, timeout = 30000) {
  await page.waitForFunction(
    (n) => {
      const el = document.querySelector('main[data-state]');
      return el && el.getAttribute('data-state')?.includes(n);
    },
    { timeout },
    needle,
  );
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await sleep(250);
  await page.screenshot({ path: file, type: 'png' });
  console.log('wrote', path.relative(ROOT, file));
}

async function selectScenario(page, id) {
  const current = new URL(page.url());
  current.pathname = '/developer/';
  await page.goto(current.toString(), { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="scenario-select"]', { visible: true });
  await page.select('[data-testid="scenario-select"]', id);
  await page.click('.dev-close');
  await page.waitForSelector('.dev-panel', { hidden: true, timeout: 5000 }).catch(() => {});
}

async function ensureListening(page) {
  for (let i = 0; i < 40; i++) {
    const state = await page.$eval('main[data-state]', (el) => el.getAttribute('data-state') || '');
    if (state.includes('listening')) return;
    if (state.includes('prompting')) {
      const skip = await page.$('[data-testid="skip-prompt"]');
      if (skip) await skip.click();
    }
    await sleep(200);
  }
  throw new Error('never reached listening');
}

async function recordOneSegment(page, { captureListeningAs } = {}) {
  await ensureListening(page);
  if (captureListeningAs) await shot(page, captureListeningAs);
  await sleep(400);
  await clickTestId(page, 'stop');
  await waitState(page, 'segmentDecision');
}

async function waitForDelivered(page) {
  await waitState(page, 'result');
  for (let i = 0; i < 50; i++) {
    const state = await page.$eval('main[data-state]', (el) => el.getAttribute('data-state') || '');
    if (state.includes('delivered')) return;
    const play = await page.$('[data-testid="play"]:not([disabled])');
    if (play) await play.click().catch(() => {});
    await page.evaluate(() => {
      document.querySelectorAll('audio').forEach((el) => {
        el.dispatchEvent(new Event('ended'));
      });
    });
    await sleep(200);
  }
  throw new Error('never reached delivered');
}

async function goHome(page) {
  const newTurn = await page.$('[data-testid="new-turn"]');
  if (newTurn) {
    await newTurn.click();
    await waitState(page, 'idle');
    return;
  }
  const cancel = await page.$('[data-testid="cancel"]:not(.is-hidden)');
  if (cancel) {
    await cancel.click();
    await waitState(page, 'idle');
  }
}

async function main() {
  await fs.mkdir(path.join(OUT, 'zh-sv'), { recursive: true });
  await fs.mkdir(path.join(OUT, 'sv-zh'), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: [
      '--ignore-certificate-errors',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=390,900',
    ],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Headless: finish media quickly so delivery / prompts don't hang.
  await page.evaluateOnNewDocument(() => {
    const proto = HTMLMediaElement.prototype;
    const originalPlay = proto.play;
    proto.play = function play() {
      this.muted = true;
      try {
        if (Number.isFinite(this.duration) && this.duration > 0) this.currentTime = this.duration;
      } catch {
        /* ignore seek errors on empty src */
      }
      const played = originalPlay.apply(this, []);
      Promise.resolve(played)
        .catch(() => undefined)
        .then(() => {
          setTimeout(() => this.dispatchEvent(new Event('ended')), 20);
        });
      return played;
    };
    if ('speechSynthesis' in window) {
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (utterance) => {
        speak(utterance);
        setTimeout(() => {
          if (typeof utterance.onend === 'function') utterance.onend(new Event('end'));
        }, 30);
      };
    }
  });

  await page.goto(`${BASE}/?preset=mock`, { waitUntil: 'networkidle0' });
  await waitForTestId(page, 'start-zh-sv');

  await shot(page, '01-home.png');

  // ZH → SV (T01 clear sentence → confirm → result)
  await selectScenario(page, 'T01');
  await clickTestId(page, 'start-zh-sv');
  await recordOneSegment(page, { captureListeningAs: 'zh-sv/02-listening.png' });
  await shot(page, 'zh-sv/03-continue.png');
  await clickTestId(page, 'finish');
  await waitState(page, 'confirm');
  await shot(page, 'zh-sv/05-confirm.png');
  await clickTestId(page, 'confirm-yes');
  await waitForDelivered(page);
  await shot(page, 'zh-sv/06-result.png');
  await goHome(page);

  // ZH → SV clarification (T04)
  await selectScenario(page, 'T04');
  await clickTestId(page, 'start-zh-sv');
  await recordOneSegment(page);
  await clickTestId(page, 'finish');
  await waitState(page, 'clarify');
  await shot(page, 'zh-sv/04-question.png');
  await goHome(page);

  // SV → ZH (T07)
  await selectScenario(page, 'T07');
  await clickTestId(page, 'start-sv-zh');
  await recordOneSegment(page, { captureListeningAs: 'sv-zh/02-listening.png' });
  await shot(page, 'sv-zh/03-continue.png');
  await clickTestId(page, 'finish');
  await waitForDelivered(page);
  await shot(page, 'sv-zh/06-result.png');
  await goHome(page);

  await browser.close();
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
