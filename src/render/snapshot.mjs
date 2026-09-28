import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backgrounds, createBackdrop } from './background.mjs';
import { createDeviceFrame, deviceLayout, drawScreen } from './device.mjs';
import { createFrame } from './scene.mjs';
import { renderSettings } from './settings.mjs';
import { drawToolbar, toolbarHeight, toolbarStyle } from './toolbar.mjs';

// The video's window (or phone) at exactly the capture scale, so the page keeps every captured pixel,
// with an even border of wallpaper: the padding's share of the longer side.
export function snapshotGeometry(timeline, { padding, window: windowStyle }) {
  const { viewport, capture: { scale } } = timeline;
  const device = windowStyle === 'device' ? deviceLayout(timeline.device, viewport) : undefined;
  const toolbar = windowStyle === 'browser' ? toolbarHeight : 0;
  const { window, frame, ratio } = device
    ? createDeviceFrame(device.body.width * scale, device.body.height * scale, viewport, 0, device)
    : createFrame(viewport.width * scale, (viewport.height + toolbar) * scale, viewport, 0, toolbar);
  const border = Math.round(Math.max(window.width, window.height) * padding / (1 - padding * 2));
  // Whole-pixel page edges: a half-pixel offset would resample and soften the capture.
  const shift = box => ({ ...box, x: box.x + border - frame.x % 1, y: box.y + border - frame.y % 1 });
  return {
    width: Math.ceil(window.width) + border * 2,
    height: Math.ceil(window.height) + border * 2,
    window: shift(window),
    frame: { ...shift(frame), ...(frame.screen && { screen: shift(frame.screen) }) },
    ratio,
    device,
  };
}

// Frames each snapshot of a capture as `snapshots/<name>.png`: a browser window on the wallpaper,
// or the phone for a phone capture.
export async function frameSnapshots(directory, options = {}) {
  const timeline = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
  if (!timeline.snapshots?.length) return [];
  const settings = renderSettings({ ...(timeline.device && { window: 'device' }), ...options });
  if (settings.window === 'device' && !timeline.device) {
    throw new Error('--window device needs a capture made with a phone "device" in the plan.');
  }
  const { width, height, window, frame, device } = snapshotGeometry(timeline, settings);
  const toolbar = settings.window === 'browser' ? await toolbarStyle(timeline, directory) : null;
  const backdrop = await createBackdrop(width, height, window, backgrounds[settings.preset], device);
  return Promise.all(timeline.snapshots.map(async ({ name, source }) => {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(backdrop, 0, 0);
    const page = await loadImage(await readFile(join(directory, source)));
    if (device) {
      drawScreen(context, { source: page, frame, device });
    } else {
      if (toolbar) drawToolbar(context, frame, toolbar);
      context.beginPath();
      context.roundRect(frame.x, frame.y, frame.width, frame.height, toolbar ? [0, 0, frame.radius, frame.radius] : frame.radius);
      context.clip();
      context.drawImage(page, frame.x, frame.y, frame.width, frame.height);
    }
    const output = join(directory, 'snapshots', `${name}.png`);
    await writeFile(output, await canvas.encode('png'));
    return output;
  }));
}
