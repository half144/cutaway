import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { validatePlan } from '../src/plan.mjs';
import { frameSnapshots, snapshotLayout } from '../src/render/snapshot.mjs';

const base = { url: 'https://example.com' };

test('snapshots take an optional selector and a unique file name', () => {
  const steps = validatePlan({ ...base, steps: [
    { action: 'wait' }, { action: 'snapshot' }, { action: 'snapshot', selector: '#card', name: 'saved-card' },
  ] }).steps;
  assert.deepEqual(steps.slice(1).map(step => step.name), ['step-2', 'saved-card']);
  for (const name of ['', '../escape', 'a b', 7]) {
    assert.throws(() => validatePlan({ ...base, steps: [{ action: 'snapshot', name }] }), /name belongs/);
  }
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'click', selector: '#a', name: 'a' }] }), /name belongs/);
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

test('a snapshot is framed in a window on the wallpaper, sized to its area', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutaway-test-'));
  try {
    const clip = { x: 10, y: 20, width: 600, height: 300 };
    await mkdir(join(dir, 'frames'));
    await mkdir(join(dir, 'snapshots', 'source'), { recursive: true });
    await writeFile(join(dir, 'frames', '000000.png'), await png(64, 36, '#ffffff'));
    await writeFile(join(dir, 'snapshots', 'source', 'card.png'), await png(1200, 600, '#ff0000'));
    await writeFile(join(dir, 'timeline.json'), JSON.stringify({
      url: 'https://app.example.com/', capture: { scale: 2 }, frames: [{ t: 0, file: 'frames/000000.png' }],
      snapshots: [{ t: 1, name: 'card', source: 'snapshots/source/card.png', clip }],
    }));

    const [output] = await frameSnapshots(dir, { preset: 'pearl' });
    const layout = snapshotLayout(clip, 2, true);
    const center = await pixel(output, layout.frame.x + layout.frame.width / 2, layout.frame.y + layout.frame.height / 2);
    assert.deepEqual([center.width, center.height], [layout.width, layout.height]);
    assert.deepEqual(center.rgb, [255, 0, 0]);
    assert.notDeepEqual((await pixel(output, 2, 2)).rgb, [255, 0, 0]);

    await frameSnapshots(dir, { preset: 'pearl', window: 'none' });
    assert.equal((await pixel(output, 0, 0)).height, snapshotLayout(clip, 2, false).height);
    assert.ok(snapshotLayout(clip, 2, false).height < layout.height);
  } finally {
    await rm(dir, { recursive: true });
  }
});
