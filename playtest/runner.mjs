#!/usr/bin/env node
/**
 * Gamemaster Playwright Playtest Runner
 *
 * Env:
 *   PLAYTEST_URL          default http://127.0.0.1:5173
 *   PLAYTEST_OUT          output dir for screenshots + report.json
 *   PLAYTEST_DURATION_MS  default 20000
 *   PLAYTEST_WIDTH/HEIGHT default 390x844 (phone-ish)
 *   PLAYTEST_ACTIONS      jump|wasd|click|idle  (comma list)
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const URL = process.env.PLAYTEST_URL || 'http://127.0.0.1:5173';
const OUT = process.env.PLAYTEST_OUT || path.join(process.cwd(), '.gamemaster', 'playtest');
const DURATION = Number(process.env.PLAYTEST_DURATION_MS || 20000);
const W = Number(process.env.PLAYTEST_WIDTH || 390);
const H = Number(process.env.PLAYTEST_HEIGHT || 844);
const ACTIONS = (process.env.PLAYTEST_ACTIONS || 'jump,wasd,click').split(',').map((s) => s.trim());

fs.mkdirSync(OUT, { recursive: true });

const report = {
  tool: 'Gamemaster Playtest',
  url: URL,
  startedAt: new Date().toISOString(),
  durationMs: DURATION,
  viewport: { width: W, height: H },
  actions: ACTIONS,
  ok: false,
  errors: [],
  console: [],
  pageErrors: [],
  metrics: null,
  screenshots: [],
  timings: {},
  notes: [],
};

function shot(name) {
  return path.join(OUT, `${name}.png`);
}

const INJECT = `
(() => {
  if (window.__GF_PLAYTEST__) return;
  const m = {
    t0: performance.now(),
    deaths: 0,
    restarts: 0,
    jumps: 0,
    clicks: 0,
    keys: 0,
    firstInputAt: null,
    firstDeathAt: null,
    deathToRestartMs: [],
    lastDeathAt: null,
    frames: 0,
    maxDt: 0,
    canvas: null,
  };
  let last = performance.now();
  const markInput = () => {
    if (m.firstInputAt == null) m.firstInputAt = performance.now() - m.t0;
  };
  window.addEventListener('keydown', () => { m.keys++; markInput(); }, true);
  window.addEventListener('pointerdown', () => { m.clicks++; markInput(); }, true);

  // Hook common patterns
  const _raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => _raf((ts) => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    m.frames++;
    if (dt < 1000) m.maxDt = Math.max(m.maxDt, dt);
    try { return cb(ts); } catch (e) { console.error(e); throw e; }
  });

  // Public API games can call
  window.__GF_PLAYTEST__ = {
    metrics: m,
    recordDeath() {
      m.deaths++;
      const t = performance.now();
      if (m.firstDeathAt == null) m.firstDeathAt = t - m.t0;
      m.lastDeathAt = t;
    },
    recordRestart() {
      m.restarts++;
      if (m.lastDeathAt) {
        m.deathToRestartMs.push(performance.now() - m.lastDeathAt);
        m.lastDeathAt = null;
      }
    },
    recordJump() { m.jumps++; markInput(); },
    dump() {
      const live = performance.now() - m.t0;
      return {
        ...m,
        liveMs: live,
        avgFps: m.frames > 10 ? (m.frames / (live / 1000)) : null,
        medianDeathToRestartMs: median(m.deathToRestartMs),
        hasCanvas: !!document.querySelector('canvas'),
        title: document.title,
      };
    },
  };
  function median(arr) {
    if (!arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    const mid = (a.length / 2) | 0;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  // Heuristic: if game exposes CONFIG or player.hp drops — soft detect via console is enough
  console.info('[Gamemaster Playtest] harness injected');
})();
`;

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || res.status === 404) return true;
    } catch {
      // not up
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  const t0 = Date.now();
  const up = await waitForServer(URL, 90000);
  report.timings.serverWaitMs = Date.now() - t0;
  if (!up) {
    report.errors.push(`Server not reachable: ${URL}`);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    report.console.push({ type: msg.type(), text: text.slice(0, 500) });
    if (msg.type() === 'error') report.errors.push(text.slice(0, 500));
  });
  page.on('pageerror', (err) => {
    report.pageErrors.push(String(err).slice(0, 500));
    report.errors.push(String(err).slice(0, 500));
  });

  await page.addInitScript(INJECT);

  const navT = Date.now();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
  } catch (e) {
    report.errors.push(`navigation: ${e.message}`);
  }
  report.timings.navigateMs = Date.now() - navT;

  // initial screenshot
  const s0 = shot('00-start');
  await page.screenshot({ path: s0, fullPage: false });
  report.screenshots.push(s0);

  const end = Date.now() + DURATION;
  let tick = 0;
  while (Date.now() < end) {
    tick++;
    try {
      if (ACTIONS.includes('click')) {
        const box = await page.locator('canvas').boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
        } else {
          await page.mouse.click(W * 0.5, H * 0.5);
        }
        await page.evaluate(() => window.__GF_PLAYTEST__?.recordJump?.());
      }
      if (ACTIONS.includes('jump')) {
        await page.keyboard.down('Space');
        await page.waitForTimeout(80);
        await page.keyboard.up('Space');
        await page.evaluate(() => window.__GF_PLAYTEST__?.recordJump?.());
      }
      if (ACTIONS.includes('wasd')) {
        const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
        const k = keys[tick % keys.length];
        await page.keyboard.down(k);
        await page.waitForTimeout(120);
        await page.keyboard.up(k);
      }
      // try common restart keys when "dead" UI might show
      if (tick % 8 === 0) {
        await page.keyboard.press('KeyR');
        await page.keyboard.press('Enter');
        await page.evaluate(() => window.__GF_PLAYTEST__?.recordRestart?.());
      }
    } catch (e) {
      report.notes.push(`action error: ${e.message}`);
    }

    if (tick === 3) {
      const s1 = shot('01-mid');
      await page.screenshot({ path: s1, fullPage: false });
      report.screenshots.push(s1);
    }
    await page.waitForTimeout(350);
  }

  const s2 = shot('02-end');
  await page.screenshot({ path: s2, fullPage: false });
  report.screenshots.push(s2);

  try {
    report.metrics = await page.evaluate(() => {
      if (window.__GF_PLAYTEST__?.dump) return window.__GF_PLAYTEST__.dump();
      return {
        hasCanvas: !!document.querySelector('canvas'),
        title: document.title,
        bodyText: (document.body?.innerText || '').slice(0, 400),
      };
    });
  } catch (e) {
    report.errors.push(`metrics: ${e.message}`);
  }

  // Heuristic death detection from console
  for (const c of report.console) {
    if (/death|died|game over|restart/i.test(c.text)) {
      report.notes.push(`console signal: ${c.text.slice(0, 120)}`);
    }
  }

  report.ok = report.pageErrors.length === 0 && report.errors.filter((e) => !/favicon/i.test(e)).length === 0;
  report.finishedAt = new Date().toISOString();
  report.timings.totalMs = Date.now() - t0;

  // rubric hints
  report.rubricHints = {
    loads: !report.errors.some((e) => /navigation|Server not/i.test(e)),
    hasCanvas: !!(report.metrics && report.metrics.hasCanvas),
    inputResponded: !!(report.metrics && (report.metrics.clicks > 0 || report.metrics.keys > 0)),
    fpsOk: report.metrics?.avgFps == null ? null : report.metrics.avgFps > 25,
    deathToRestartMedianMs: report.metrics?.medianDeathToRestartMs ?? null,
    errorCount: report.pageErrors.length,
  };

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  // short markdown for critic
  const md = [
    '# Playtest Report',
    '',
    `- URL: ${URL}`,
    `- OK: ${report.ok}`,
    `- Viewport: ${W}x${H}`,
    `- Duration: ${DURATION}ms`,
    `- Screenshots: ${report.screenshots.length}`,
    `- Page errors: ${report.pageErrors.length}`,
    `- Console errors: ${report.errors.length}`,
    '',
    '## Metrics',
    '```json',
    JSON.stringify(report.metrics, null, 2),
    '```',
    '',
    '## Rubric hints',
    '```json',
    JSON.stringify(report.rubricHints, null, 2),
    '```',
    '',
    '## Notes',
    ...(report.notes.map((n) => `- ${n}`)),
    '',
    '## Page errors',
    ...(report.pageErrors.map((e) => `- ${e}`) || ['- none']),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);

  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, out: OUT, metrics: report.metrics, rubricHints: report.rubricHints }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  report.errors.push(String(e.stack || e));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(1);
});
