import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { renderSettings, render } from '../src/render.mjs';
import { concatSegments, VideoEncoder } from '../src/render/encoder.mjs';
import { splitSegments } from '../src/render/segments.mjs';

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
  const dir = await mkdtemp(join(tmpdir(), 'cutaway-test-'));
  try {
    await writeFile(join(dir, 'timeline.json'), JSON.stringify({ status: 'failed', frames: [{ t: 0 }] }));
    await assert.rejects(render(dir), /incomplete recording/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

const ffmpegReady = spawnSync('ffprobe', ['-version']).status === 0;

test('exports keep sRGB colors and tag them 1-13-1 so QuickTime shows no gamma shift', { skip: !ffmpegReady }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutaway-test-'));
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

test('work splits into contiguous runs, shorter where the camera moves', () => {
  const still = { x: 720, y: 405, zoom: 1 };
  const frames = Array.from({ length: 300 }, (_, i) => ({ camera: i < 100 ? { ...still, zoom: 1 + i * 0.005 } : still }));
  const segments = splitSegments(frames, 3, { ratio: 1, width: 1920, height: 1080, blur: 0.75, quality: 'high' });
  assert.equal(segments.length, 3);
  assert.equal(segments[0].start, 0);
  assert.equal(segments.at(-1).end, frames.length);
  segments.slice(1).forEach((segment, index) => assert.equal(segment.start, segments[index].end));
  assert.ok(segments[0].end < 100, 'the zooming stretch is shared between segments');
});

function probeVideo(path) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
    'stream=nb_read_frames,color_transfer', '-of', 'json', path]);
  return JSON.parse(probe.stdout).streams[0];
}

test('segments join into one video with every frame in order and the color tags', { skip: !ffmpegReady }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutaway-test-'));
  try {
    const parts = [[[255, 0, 0], 30], [[0, 0, 255], 45]];
    const paths = [];
    for (const [index, [color, count]] of parts.entries()) {
      const frame = Buffer.alloc(64 * 32 * 4);
      for (let i = 0; i < 64 * 32; i++) frame.set([...color, 255], i * 4);
      paths.push(join(dir, `${index}.mp4`));
      const encoder = new VideoEncoder(paths[index], 64, 32, 60);
      for (let i = 0; i < count; i++) await encoder.write(frame);
      await encoder.finish();
    }
    const output = join(dir, 'joined.mp4');
    await concatSegments(paths, output);
    assert.deepEqual(probeVideo(output), { nb_read_frames: '75', color_transfer: 'iec61966-2-1' });
    const pixel = seconds => [...spawnSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', output, '-frames:v', '1',
      '-vf', 'format=rgb24', '-f', 'rawvideo', '-']).stdout.subarray(0, 3)];
    const [first, last] = [pixel(0), pixel(1.2)];
    assert.ok(first[0] > 200 && first[2] < 60);
    assert.ok(last[2] > 200 && last[0] < 60);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('a recording renders across processes into one complete video', { skip: !ffmpegReady }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutaway-test-'));
  try {
    await mkdir(join(dir, 'frames'));
    const canvas = createCanvas(640, 360);
    const context = canvas.getContext('2d');
    const frames = [];
    for (const [index, color] of ['#f4f4f6', '#dde3ea', '#c9d4df'].entries()) {
      context.fillStyle = color;
      context.fillRect(0, 0, 640, 360);
      frames.push({ t: index * 0.8, file: `frames/${index}.png` });
      await writeFile(join(dir, frames[index].file), await canvas.encode('png'));
    }
    await writeFile(join(dir, 'timeline.json'), JSON.stringify({
      version: 1, viewport: { width: 640, height: 360 }, capture: { scale: 1, format: 'png' }, frames,
      points: [{ t: 0, x: 320, y: 200 }, { t: 1, x: 420, y: 150 }],
      clicks: [], focuses: [], steps: [], scrolls: [], cursors: [], keys: [], duration: 2.4, status: 'complete',
    }));
    const report = await render(dir, { width: 640, height: 360, fps: 24, preset: 'pearl', workers: 2 });
    assert.equal(report.renderProcesses, 2);
    assert.equal(probeVideo(join(dir, 'video.mp4')).nb_read_frames, String(report.outputFrames));
    assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.parts')), []);
  } finally {
    await rm(dir, { recursive: true });
  }
});
