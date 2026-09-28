import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { targetNeedsScroll, waitForSettled, waitForStableTarget, watchChanges } from './page-state.mjs';

// Room left around the element, in page pixels, so its border and shadow are not cut.
const margin = 16;

// Saves the area of the page a snapshot frames: the element with a margin, or the whole viewport.
// The render frames it later, like the video's window.
export async function takeSnapshot(page, step, index, directory, timeline, now) {
  const viewport = page.viewportSize();
  let clip = { x: 0, y: 0, ...viewport };
  if (step.selector) {
    const locator = page.locator(step.selector);
    await locator.waitFor({ state: 'visible' });
    if (await locator.count() !== 1) throw new Error(`Step ${index + 1}: selector must match exactly one element.`);
    if (await locator.evaluate(targetNeedsScroll)) {
      await locator.evaluate(target => target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }));
      await locator.evaluate(waitForStableTarget);
    }
    const box = await locator.boundingBox();
    const x = Math.max(0, Math.floor(box.x - margin));
    const y = Math.max(0, Math.floor(box.y - margin));
    clip = {
      x, y,
      width: Math.min(viewport.width, Math.ceil(box.x + box.width + margin)) - x,
      height: Math.min(viewport.height, Math.ceil(box.y + box.height + margin)) - y,
    };
  }
  await page.evaluate(watchChanges);
  await page.evaluate(waitForSettled, { limit: 1500 });
  const source = `snapshots/source/${step.name}.png`;
  await mkdir(join(directory, 'snapshots', 'source'), { recursive: true });
  await page.screenshot({ path: join(directory, source), clip });
  (timeline.snapshots ??= []).push({ t: now(), name: step.name, source, clip });
}
