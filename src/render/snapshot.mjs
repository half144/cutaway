import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backgrounds, createBackdrop } from './background.mjs';
import { renderSettings } from './settings.mjs';
import { drawToolbar, toolbarHeight, toolbarStyle } from './toolbar.mjs';

const windowRadius = 12;
// Below this width (page pixels) the address field would run into the traffic lights.
const addressWidth = 480;

// The image fits the area rather than a video size: a small card stays small, with the wallpaper
// as an even border around its window.
export function snapshotLayout(clip, scale, toolbar) {
  const bar = toolbar ? toolbarHeight : 0;
  const border = Math.round(Math.max(48, 0.08 * Math.max(clip.width, clip.height + bar)));
  const window = {
    x: border * scale,
    y: border * scale,
    width: clip.width * scale,
    height: (clip.height + bar) * scale,
    radius: windowRadius * scale,
  };
  const frame = { ...window, y: window.y + bar * scale, height: clip.height * scale, toolbar: bar * scale };
  return {
    width: Math.round((clip.width + border * 2) * scale),
    height: Math.round((clip.height + bar + border * 2) * scale),
    window,
    frame,
  };
}

// Frames each snapshot of a capture as `snapshots/<name>.png`. Phones get a rounded screen without
// browser chrome.
export async function frameSnapshots(directory, options = {}) {
  const timeline = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
  if (!timeline.snapshots?.length) return [];
  const { preset, window: windowStyle } = renderSettings(options);
  const toolbar = windowStyle === 'browser' && !timeline.device ? await toolbarStyle(timeline, directory) : null;
  return Promise.all(timeline.snapshots.map(async ({ name, source, clip }) => {
    const { width, height, window, frame } = snapshotLayout(clip, timeline.capture.scale, toolbar);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(await createBackdrop(width, height, window, backgrounds[preset]), 0, 0);
    if (toolbar) drawToolbar(context, frame, clip.width < addressWidth ? { ...toolbar, host: null } : toolbar);
    context.beginPath();
    context.roundRect(frame.x, frame.y, frame.width, frame.height, toolbar ? [0, 0, frame.radius, frame.radius] : frame.radius);
    context.clip();
    context.drawImage(await loadImage(await readFile(join(directory, source))), frame.x, frame.y, frame.width, frame.height);
    const output = join(directory, 'snapshots', `${name}.png`);
    await writeFile(output, await canvas.encode('png'));
    return output;
  }));
}
