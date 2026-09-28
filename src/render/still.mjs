import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { mobileDevice } from '../plan.mjs';
import { backgrounds, createBackdrop } from './background.mjs';
import { createDeviceFrame, deviceLayout, drawScreen } from './device.mjs';
import { createFrame } from './scene.mjs';
import { renderSettings } from './settings.mjs';
import { drawToolbar, toolbarHeight, toolbarStyle } from './toolbar.mjs';
import { framePreset } from './wallpapers.mjs';

// The video's window (or phone) at exactly the screenshot's scale, so the page keeps every pixel,
// with an even border of wallpaper: the padding's share of the longer side.
export function stillGeometry({ viewport, scale, device }, { padding, window: windowStyle }) {
  const layout = windowStyle === 'device' ? deviceLayout(device, viewport) : undefined;
  const toolbar = windowStyle === 'browser' ? toolbarHeight : 0;
  const { window, frame, ratio } = layout
    ? createDeviceFrame(layout.body.width * scale, layout.body.height * scale, viewport, 0, layout)
    : createFrame(viewport.width * scale, (viewport.height + toolbar) * scale, viewport, 0, toolbar);
  const border = Math.round(Math.max(window.width, window.height) * padding / (1 - padding * 2));
  // Whole-pixel page edges: a half-pixel offset would resample and soften the screenshot.
  const shift = box => ({ ...box, x: box.x + border - frame.x % 1, y: box.y + border - frame.y % 1 });
  return {
    width: Math.ceil(window.width) + border * 2,
    height: Math.ceil(window.height) + border * 2,
    window: shift(window),
    frame: { ...shift(frame), ...(frame.screen && { screen: shift(frame.screen) }) },
    ratio,
    layout,
  };
}

// Frames a screenshot of the viewport like the video: a browser window on the wallpaper, or the phone.
// A phone screenshot is the page between the system bars, at the phone's width.
export async function frameImage(input, { url, device: name, scale, output, ...options } = {}) {
  const page = await loadImage(await readFile(input));
  const device = name === undefined ? undefined : mobileDevice(name);
  const settings = renderSettings({ preset: framePreset, ...(device && { window: 'device' }), ...options });
  if (settings.window === 'device' && !device) throw new Error('--window device needs --device.');
  scale ??= device ? page.width / device.screen.width : 2;
  if (!Number.isFinite(scale) || scale < 1 || scale > 3) throw new Error('--scale must be between 1 and 3.');
  const viewport = { width: page.width / scale, height: page.height / scale };
  if (device) {
    const { screen, insets } = device;
    const height = screen.height - insets.top - insets.bottom;
    if (viewport.width !== screen.width || Math.round(viewport.height) !== height) {
      throw new Error(`The ${device.name} screenshot must be ${screen.width}×${height} at its scale, the page between the system bars; `
        + `this one is ${+viewport.width.toFixed(1)}×${+viewport.height.toFixed(1)}. In agent-browser: set viewport ${screen.width} ${height} 3`);
    }
  }
  const { width, height, window, frame, layout } = stillGeometry({ viewport, scale, device }, settings);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(await createBackdrop(width, height, window, backgrounds[settings.preset], layout), 0, 0);
  if (layout) {
    drawScreen(context, { source: page, frame, device: layout });
  } else {
    const toolbar = settings.window === 'browser' ? await toolbarStyle(input, url) : null;
    if (toolbar) drawToolbar(context, frame, toolbar);
    context.beginPath();
    context.roundRect(frame.x, frame.y, frame.width, frame.height, toolbar ? [0, 0, frame.radius, frame.radius] : frame.radius);
    context.clip();
    context.drawImage(page, frame.x, frame.y, frame.width, frame.height);
  }
  const path = output ?? input.replace(/(\.[^./]+)?$/, '.framed.png');
  await writeFile(path, await canvas.encode('png'));
  return path;
}
