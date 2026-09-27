import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { renderSettings, render } from '../src/render.mjs';
import { VideoEncoder } from '../src/render/encoder.mjs';

test('output validation rejects invalid dimensions, motion options and presets', () => {
  for (const options of [{ width: 721 }, { height: NaN }, { fps: 29.5 }, { blur: -1 }, { maxZoom: Infinity }, { preset: 'unknown' },
    { pacing: 'rushed' }, { window: 'tabs' }, { keys: 'some' }]) {
    assert.throws(() => renderSettings(options));
  }
});

test('an unknown preset lists the available backgrounds, including imported wallpapers', () => {
  assert.throws(() => renderSettings({ preset: 'nope' }), /Available: macos, .*dusk, midnight, pearl/);
});

test('zoom and motion blur can be disabled independently', () => {
  assert.equal(renderSettings({ blur: 0 }).blur, 0);
  assert.equal(renderSettings({ maxZoom: 1 }).maxZoom, 1);
  assert.equal(renderSettings({ maxZoom: 1 }).blur, 0.75);
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

const ffmpegReady = spawnSync('ffprobe', ['-version']).status === 0;

test('exports keep sRGB colors and tag them 1-13-1 so QuickTime shows no gamma shift', { skip: !ffmpegReady }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-screen-test-'));
  try {
    const output = join(dir, 'colors.mp4');
    const colors = [[255, 255, 255], [0, 0, 0], [128, 128, 128], [243, 244, 246]];
    const frame = Buffer.alloc(64 * 32 * 4);
    for (let i = 0; i < 64 * 32; i++) frame.set([...colors[Math.floor(i % 64 / 16)], 255], i * 4);
    const encoder = new VideoEncoder(output, 64, 32, 60);
    for (let i = 0; i < 3; i++) await encoder.write(frame);
    await encoder.finish();
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=color_primaries,color_transfer,color_space,color_range', '-of', 'json', output]);
    assert.deepEqual(JSON.parse(probe.stdout).streams[0], {
      color_range: 'tv', color_space: 'bt709', color_transfer: 'iec61966-2-1', color_primaries: 'bt709',
    });
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', output, '-frames:v', '1', '-vf',
      'scale=in_range=tv:in_color_matrix=bt709:out_range=full:flags=accurate_rnd+full_chroma_int,format=rgb24',
      '-f', 'rawvideo', '-']).stdout;
    // Within the one-level rounding of 8-bit limited-range YCbCr.
    colors.forEach((color, index) => {
      const offset = (16 * 64 + index * 16 + 8) * 3;
      color.forEach((value, channel) => assert.ok(Math.abs(decoded[offset + channel] - value) <= 1));
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});
