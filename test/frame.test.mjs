import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mobileDevice } from '../src/plan.mjs';
import { frameImage, stillGeometry } from '../src/render/still.mjs';

async function screenshot(dir, width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, width, height);
  const path = join(dir, 'shot.png');
  await writeFile(path, await canvas.encode('png'));
  return path;
}

async function pixel(file, x, y) {
  const image = await loadImage(await readFile(file));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, rgb: [...context.getImageData(x, y, 1, 1).data.slice(0, 3)] };
}

async function inTemp(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cutaway-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

test('a web screenshot sits in the browser window on the wallpaper, without resampling', () => inTemp(async dir => {
  const input = await screenshot(dir, 2880, 1620);
  const output = await frameImage(input, { url: 'https://app.example.com/reports', preset: 'pearl' });
  assert.equal(output, join(dir, 'shot.framed.png'));
  const { width, height, frame, ratio } = stillGeometry({ viewport: { width: 1440, height: 810 }, scale: 2 }, { padding: 0.09, window: 'browser' });
  assert.equal(ratio, 2);
  assert.ok(Number.isInteger(frame.x) && Number.isInteger(frame.y));
  const center = await pixel(output, frame.x + frame.width / 2, frame.y + frame.height / 2);
  assert.deepEqual([center.width, center.height, center.rgb], [width, height, [255, 0, 0]]);
  assert.notDeepEqual((await pixel(output, 2, 2)).rgb, [255, 0, 0]);
  await assert.rejects(frameImage(input, { window: 'device' }), /needs --device/);
  await assert.rejects(frameImage(input, { scale: 4 }), /--scale/);
}));

test('a phone screenshot is drawn inside the phone, at the phone scale', () => inTemp(async dir => {
  const device = mobileDevice('iPhone 15 Pro');
  const output = await frameImage(await screenshot(dir, 1179, 2292), { device: 'iPhone 15 Pro', preset: 'pearl' });
  const { width, height, frame, window, ratio } = stillGeometry({ viewport: { width: 393, height: 764 }, scale: 3, device }, { padding: 0.09, window: 'device' });
  assert.equal(ratio, 3);
  assert.ok(height > width && Number.isInteger(frame.x) && Number.isInteger(frame.y));
  const center = await pixel(output, frame.x + frame.width / 2, frame.y + frame.height / 2);
  assert.deepEqual([center.width, center.height, center.rgb], [width, height, [255, 0, 0]]);
  // The bezel between the glass and the body's edge.
  assert.notDeepEqual((await pixel(output, window.x + 6 * ratio, window.y + window.height / 2)).rgb, [255, 0, 0]);
}));

test('a phone screenshot with the browser bars in it is refused with the viewport to use', () => inTemp(async dir => {
  // Playwright's iPhone 15 Pro viewport leaves room for Safari's bars: 393×659.
  await assert.rejects(frameImage(await screenshot(dir, 1179, 1977), { device: 'iPhone 15 Pro' }),
    /must be 393×764 .*this one is 393×659.*set viewport 393 764 3/);
}));
