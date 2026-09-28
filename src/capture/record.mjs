import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, devices } from 'playwright';
import { loadPlan } from '../plan.mjs';
import { ActionRunner } from './actions.mjs';
import { hideElements, invalidSelectors, isQuietSpot, waitForSettled, watchChanges } from './page-state.mjs';
import { ScreencastRecorder } from './screencast.mjs';
import { takeSnapshot } from './snapshot.mjs';
import { TouchRunner } from './touch.mjs';

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

// Without video, only the snapshots are kept: no screencast and no opening or closing beat.
export async function record(planPath, directory, { headed = false, storageState, video = true } = {}) {
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
  timeline.video = video;
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
    // A phone is emulated in Playwright's Chromium, which the CDP screencast needs, rather than the WebKit
    // its descriptor names: user agent, touch input and mobile layout come from the descriptor.
    const { defaultBrowserType, viewport, deviceScaleFactor, ...phone } = plan.device ? devices[plan.device.name] : {};
    const context = await browser.newContext({
      ...phone, screen: plan.device?.screen, viewport: plan.viewport, deviceScaleFactor: plan.captureScale, storageState,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(plan.timeout ?? 10000);
    context.on('page', popup => {
      if (popup !== page) popupError = new Error('Popups are not supported in this version. Use a single-tab flow.');
    });

    if (plan.hide) await page.addInitScript(hideElements, plan.hide);
    await page.goto(plan.url, { waitUntil: 'load' });
    const invalid = plan.hide ? await page.evaluate(invalidSelectors, plan.hide) : [];
    if (invalid.length) throw new Error(`hide takes CSS selectors; the browser rejected: ${invalid.join(', ')}`);
    await page.evaluate(() => document.fonts.ready);
    // Open on a still page: entrance animations and late layout finish before the first frame.
    await page.evaluate(watchChanges);
    await page.evaluate(waitForSettled, { limit: 3000, quiet: 400 });

    const initialPointer = plan.device ? null : await restingPoint(page, plan.viewport);
    if (initialPointer) await page.mouse.move(initialPointer.x, initialPointer.y);
    const session = await context.newCDPSession(page);
    startedAt = Date.now();
    timeline.setupSeconds = (performance.now() - beginning) / 1000;
    if (initialPointer) timeline.points.push({ t: 0, ...initialPointer });
    if (plan.device) {
      timeline.device = plan.device;
      timeline.input = 'touch';
    }
    const initial = await page.screenshot({ type: 'png' });
    await writeFile(join(directory, 'frames', '000000.png'), initial);
    timeline.frames.push({ t: 0, file: 'frames/000000.png' });

    if (video) {
      capture = new ScreencastRecorder(session, directory, timeline, {
        width: Math.round(plan.viewport.width * plan.captureScale),
        height: Math.round(plan.viewport.height * plan.captureScale),
      }, startedAt);
      await capture.start();
      // A calm opening beat before the first gesture.
      await sleep(600);
    }

    const actions = plan.device ? new TouchRunner(page, timeline, now, session) : new ActionRunner(page, timeline, now, initialPointer);
    for (const [index, step] of plan.steps.entries()) {
      assertHealthy();
      process.stderr.write(`Recording ${index + 1}/${plan.steps.length}: ${step.action}\n`);
      const recordStep = { action: step.action, start: now() };
      timeline.steps.push(recordStep);
      if (step.action === 'snapshot') await takeSnapshot(page, step, index, directory, timeline, now);
      else Object.assign(recordStep, await actions.run(step, index, plan.steps[index + 1]));
      recordStep.end = now();
    }

    if (video) await sleep(2600);
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
