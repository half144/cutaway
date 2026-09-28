import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { validatePlan } from '../src/plan.mjs';
import { frameSnapshots, snapshotGeometry } from '../src/render/snapshot.mjs';

const base = { url: 'https://example.com' };

test('a snapshot frames the whole screen, under a unique file name', () => {
  const steps = validatePlan({ ...base, steps: [{ action: 'wait' }, { action: 'snapshot' }, { action: 'snapshot', name: 'saved-card' }] }).steps;
  assert.deepEqual(steps.slice(1).map(step => step.name), ['step-2', 'saved-card']);
  for (const name of ['', '../escape', 'a b', 7]) {
    assert.throws(() => validatePlan({ ...base, steps: [{ action: 'snapshot', name }] }), /name belongs/);
  }
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'click', selector: '#a', name: 'a' }] }), /name belongs/);
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'snapshot', selector: '#card' }] }), /whole screen/);
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'snapshot', name: 'a' }, { action: 'snapshot', name: 'a' }] }),
    /Step 2: another snapshot is already named "a"/);
});

function png(width, height, color) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas.encode('png');
}

async function pixel(file, x, y) {
  const image = await loadImage(await readFile(file));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, rgb: [...context.getImageData(x, y, 1, 1).data.slice(0, 3)] };
}

async function capture(timeline, width, height) {
  const dir = await mkdtemp(join(tmpdir(), 'cutaway-test-'));
  await mkdir(join(dir, 'frames'));
  await mkdir(join(dir, 'snapshots', 'source'), { recursive: true });
  await writeFile(join(dir, 'frames', '000000.png'), await png(64, 36, '#ffffff'));
  await writeFile(join(dir, 'snapshots', 'source', 'page.png'), await png(width, height, '#ff0000'));
  await writeFile(join(dir, 'timeline.json'), JSON.stringify({
    url: 'https://app.example.com/', frames: [{ t: 0, file: 'frames/000000.png' }],
    snapshots: [{ t: 1, name: 'page', source: 'snapshots/source/page.png' }], ...timeline,
  }));
  return dir;
}

test('a web snapshot sits in the browser window on the wallpaper, at the capture scale', async () => {
  const timeline = { viewport: { width: 1440, height: 810 }, capture: { scale: 2 } };
  const dir = await capture(timeline, 2880, 1620);
  try {
    const [output] = await frameSnapshots(dir, { preset: 'pearl' });
    const { width, height, frame, ratio } = snapshotGeometry(timeline, { padding: 0.09, window: 'browser' });
    assert.equal(ratio, 2);
    assert.ok(Number.isInteger(frame.x) && Number.isInteger(frame.y));
    const center = await pixel(output, frame.x + frame.width / 2, frame.y + frame.height / 2);
    assert.deepEqual([center.width, center.height, center.rgb], [width, height, [255, 0, 0]]);
    assert.notDeepEqual((await pixel(output, 2, 2)).rgb, [255, 0, 0]);
    await assert.rejects(frameSnapshots(dir, { window: 'device' }), /needs a capture made with a phone/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('a phone snapshot is drawn inside the phone', async () => {
  const device = validatePlan({ ...base, device: 'iPhone 15 Pro', steps: [{ action: 'snapshot' }] }).device;
  const timeline = { viewport: { width: 393, height: 764 }, capture: { scale: 3 }, device };
  const dir = await capture(timeline, 1179, 2292);
  try {
    const [output] = await frameSnapshots(dir, { preset: 'pearl' });
    const { width, height, frame, window, ratio } = snapshotGeometry(timeline, { padding: 0.09, window: 'device' });
    assert.equal(ratio, 3);
    assert.ok(Number.isInteger(frame.x) && Number.isInteger(frame.y));
    assert.ok(height > width);
    const center = await pixel(output, frame.x + frame.width / 2, frame.y + frame.height / 2);
    assert.deepEqual([center.width, center.height, center.rgb], [width, height, [255, 0, 0]]);
    // The bezel between the glass and the body's edge.
    assert.notDeepEqual((await pixel(output, window.x + 6 * ratio, window.y + window.height / 2)).rgb, [255, 0, 0]);
  } finally {
    await rm(dir, { recursive: true });
  }
});
