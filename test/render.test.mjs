import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderSettings, render } from '../src/render.mjs';

test('output validation rejects invalid dimensions, motion options and presets', () => {
  for (const options of [{ width: 721 }, { height: NaN }, { fps: 29.5 }, { blur: -1 }, { maxZoom: Infinity }, { preset: 'unknown' }, { pacing: 'rushed' }]) {
    assert.throws(() => renderSettings(options));
  }
});

test('zoom and motion blur can be disabled independently', () => {
  assert.equal(renderSettings({ blur: 0 }).blur, 0);
  assert.equal(renderSettings({ maxZoom: 1 }).maxZoom, 1);
  assert.equal(renderSettings({ maxZoom: 1 }).blur, 0.65);
});

test('failed captures cannot be exported as successful videos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-screen-test-'));
  try {
    await writeFile(join(dir, 'timeline.json'), JSON.stringify({ status: 'failed', frames: [{ t: 0 }] }));
    await assert.rejects(render(dir), /incomplete recording/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
