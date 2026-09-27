import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { loadPlan } from '../plan.mjs';
import { ActionRunner } from './actions.mjs';
import { isQuietSpot, waitForSettled, watchChanges } from './page-state.mjs';
import { ScreencastRecorder } from './screencast.mjs';

// Where the pointer waits before the first gesture: a spot that reacts to nothing on hover.
async function restingPoint(page, viewport) {
  const candidates = [[0.5, 0.56], [0.62, 0.7], [0.38, 0.7], [0.72, 0.42], [0.28, 0.42], [0.5, 0.86], [0.48, 0.72]];
  const points = candidates.map(([x, y]) => ({ x: viewport.width * x, y: viewport.height * y }));
  for (const point of points) {
    if (await page.evaluate(isQuietSpot, point)) return point;
  }
  return points.at(-1);
}

function createTimeline(viewport) {
  return {
    version: 1,
    viewport,
    frames: [],
    points: [],
    clicks: [],
    focuses: [],
    steps: [],
    scrolls: [],
    cursors: [],
    keys: [],
    duration: 0,
    status: 'recording',
  };
}

export async function record(planPath, directory, { headed = false, storageState } = {}) {
  const beginning = performance.now();
  const plan = await loadPlan(planPath);
  await mkdir(directory, { recursive: true });
  await mkdir(join(directory, 'frames'));

  // CDP captures the compositor surface, which needs physical DPI in addition to emulated DPR.
  const browser = await chromium.launch({ headless: !headed, args: [`--force-device-scale-factor=${plan.captureScale}`] });
  const timeline = createTimeline(plan.viewport);
  timeline.capture = { scale: plan.captureScale, format: 'png' };
  // The toolbar shows the page address; query strings and fragments may hold secrets.
  const address = new URL(plan.url);
  address.search = '';
  address.hash = '';
  timeline.url = address.href;
  let capture;
  let popupError;
  let startedAt;

  function now() {
    return (Date.now() - startedAt) / 1000;
  }

  function assertHealthy() {
    if (popupError) throw popupError;
    capture?.assertHealthy();
  }

  try {
    const context = await browser.newContext({ viewport: plan.viewport, deviceScaleFactor: plan.captureScale, storageState });
    const page = await context.newPage();
    page.setDefaultTimeout(plan.timeout ?? 10000);
    context.on('page', popup => {
      if (popup !== page) popupError = new Error('Popups are not supported in this version. Use a single-tab flow.');
    });

    await page.goto(plan.url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Open on a still page: entrance animations and late layout finish before the first frame.
    await page.evaluate(watchChanges);
    await page.evaluate(waitForSettled, { limit: 3000, quiet: 400 });

    const initialPointer = await restingPoint(page, plan.viewport);
    await page.mouse.move(initialPointer.x, initialPointer.y);
    const session = await context.newCDPSession(page);
    startedAt = Date.now();
    timeline.setupSeconds = (performance.now() - beginning) / 1000;
    timeline.points.push({ t: 0, ...initialPointer });
    const initial = await page.screenshot({ type: 'png' });
    await writeFile(join(directory, 'frames', '000000.png'), initial);
    timeline.frames.push({ t: 0, file: 'frames/000000.png' });

    capture = new ScreencastRecorder(session, directory, timeline, {
      width: Math.round(plan.viewport.width * plan.captureScale),
      height: Math.round(plan.viewport.height * plan.captureScale),
    }, startedAt);
    await capture.start();
    // A calm opening beat before the first gesture.
    await sleep(600);

    const actions = new ActionRunner(page, timeline, now, initialPointer);
    for (const [index, step] of plan.steps.entries()) {
      assertHealthy();
      process.stderr.write(`Recording ${index + 1}/${plan.steps.length}: ${step.action}\n`);
      const recordStep = { action: step.action, start: now() };
      timeline.steps.push(recordStep);
      const timing = await actions.run(step, index, plan.steps[index + 1]);
      Object.assign(recordStep, timing);
      recordStep.end = now();
    }

    await sleep(2600);
    assertHealthy();
    timeline.status = 'complete';
  } catch (error) {
    timeline.status = 'failed';
    timeline.error = error.message;
    throw error;
  } finally {
    timeline.duration = startedAt ? now() : 0;
    try {
      await capture?.stop();
      assertHealthy();
    } catch (error) {
      timeline.status = 'failed';
      timeline.error = error.message;
      throw error;
    } finally {
      timeline.frames.sort((a, b) => a.t - b.t);
      try {
        await writeFile(join(directory, 'timeline.json'), JSON.stringify(timeline, null, 2));
      } finally {
        await browser.close();
      }
    }
  }

  return timeline;
}
