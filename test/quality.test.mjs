import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { drawSample, createFrame, SceneRenderer } from '../src/render/scene.mjs';
import { cursorAppearance, cursorEvents } from '../src/render/cursor.mjs';
import { focusWindows, planFocusZooms, renewFocus } from '../src/render/focus.mjs';
import { paceTimeline } from '../src/render/pacing.mjs';
import { renderSettings } from '../src/render/settings.mjs';
import { validatePlan } from '../src/plan.mjs';

test('zoom samples high-density source pixels without losing detail to an intermediate resize', () => {
  const source = createCanvas(384, 384);
  const sourceContext = source.getContext('2d');
  for (let x = 0; x < 384; x++) {
    sourceContext.fillStyle = x % 2 ? '#ffffff' : '#000000';
    sourceContext.fillRect(x, 0, 1, 384);
  }
  const output = createCanvas(192, 192);
  const context = output.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const viewport = { width: 192, height: 192 };
  drawSample(context, { ...viewport, viewport, source, backdrop: createCanvas(192, 192),
    frame: createFrame(192, 192, viewport, 0).frame,
    camera: { x: 96, y: 96, zoom: 2 }, cursor: {}, pointer: null });
  const pixels = context.getImageData(20, 90, 150, 1).data;
  let contrast = 0;
  for (let i = 4; i < pixels.length; i += 4) contrast += Math.abs(pixels[i] - pixels[i - 4]);
  assert.ok(contrast / 149 > 240, 'one-pixel text-like detail must retain its contrast at 1:1 pixel mapping');
});

test('scroll breaks a zoom cluster and pointer movement cannot keep stale framing alive', () => {
  const make = t => ({ t, readyAt: t - 0.2, interactionEnd: t + 0.1, end: t + 0.1,
    action: 'click', x: 600, y: 350, width: 100, height: 40 });
  const timeline = { focuses: [make(1), make(4)], clicks: [{ t: 1.1 }, { t: 4.1 }],
    scrolls: [{ start: 2, end: 3.9 }] };
  const [first, second] = focusWindows(timeline);
  assert.ok(first.releaseAt < 2);
  renewFocus(first, 1.6, 500);
  assert.ok(first.releaseAt < 2);
  assert.equal(second.startAt, 3.9);
  assert.ok(first.releaseAt < second.startAt);
});

test('page cache reuses static pixels while cursor moves and invalidates for camera or source changes', () => {
  const viewport = { width: 192, height: 192 };
  const output = createCanvas(192, 192);
  const sample = { ...viewport, viewport, frame: createFrame(192, 192, viewport, 0.1).frame,
    source: createCanvas(384, 384), backdrop: createCanvas(192, 192),
    camera: { x: 96, y: 96, zoom: 1 }, cursor: { opacity: 1, rotation: 0, size: 1, clickAge: -1 },
    pointer: { x: 40, y: 40 } };
  const renderer = new SceneRenderer(192, 192);
  renderer.draw(output.getContext('2d'), sample);
  const first = Buffer.from(output.data());
  renderer.draw(output.getContext('2d'), { ...sample, pointer: { x: 80, y: 80 } });
  assert.equal(renderer.pageDraws, 1);
  assert.equal(renderer.cacheHits, 1);
  assert.notDeepEqual(output.data(), first);
  renderer.draw(output.getContext('2d'), { ...sample, camera: { ...sample.camera, zoom: 1.1 } });
  assert.equal(renderer.pageDraws, 2);
  renderer.draw(output.getContext('2d'), { ...sample, source: createCanvas(384, 384) });
  assert.equal(renderer.pageDraws, 3);
});

test('nearby targets share a stable frame that contains the full interaction group', () => {
  const base = { end: 3, releaseAt: 5, x: 600, y: 350, width: 80, height: 40, action: 'click' };
  const [first, second] = planFocusZooms([{ ...base, t: 1 }, { ...base, x: 700, t: 2 }],
    { width: 1440, height: 900 }, 1.8);
  assert.deepEqual(first.framingContext, { x: 600, y: 350, width: 180, height: 40 });
  assert.deepEqual(first.framingContext, second.framingContext);
});

test('idle speed ramps are monotonic, bounded, and join real-time edges without a velocity step', () => {
  for (const duration of [3, 6, 60]) {
    const source = { duration, steps: [{ action: 'wait', start: 0, interactionEnd: duration, end: duration }],
      frames: Array.from({ length: 10001 }, (_, i) => ({ t: i * duration / 10000 })) };
    const paced = paceTimeline(source).timeline;
    const dt = duration / 10000;
    const rates = paced.frames.slice(1).map((frame, i) => (frame.t - paced.frames[i].t) / dt);
    assert.ok(Math.min(...rates) >= 0.25 - 1e-6);
    assert.ok(Math.max(...rates) <= 1 + 1e-6);
    assert.equal(paced.frames[1].t, source.frames[1].t);
    for (let i = 1; i < rates.length; i++) assert.ok(Math.abs(rates[i] - rates[i - 1]) < 0.04);
    assert.equal(source.frames.at(-1).t, duration);
  }
});

test('pacing keeps movement, scrolls and explicit reading holds at their captured duration', () => {
  const source = { duration: 10, steps: [{ action: 'wait', start: 0, interactionEnd: 6, end: 10, pause: 4 }],
    points: [{ t: 1, x: 0, y: 0 }, { t: 5, x: 100, y: 0 }] };
  assert.equal(paceTimeline(source).timeline.duration, 10);
  source.points = [];
  source.scrolls = [{ start: 1, end: 5 }];
  assert.equal(paceTimeline(source).timeline.duration, 10);
  source.scrolls = [];
  const paced = paceTimeline(source).timeline;
  assert.ok(paced.duration < 10);
  assert.equal(paced.steps[0].end - paced.steps[0].interactionEnd, 4);
});

test('cursor types suppress fleeting changes and transition smoothly, with legacy fallback', () => {
  const events = cursorEvents({ cursors: [{ t: 0, type: 'arrow' }, { t: 1, type: 'hand' },
    { t: 1.03, type: 'arrow' }, { t: 2, type: 'text' }] });
  assert.ok(!events.some(event => event.type === 'hand'));
  const transition = cursorAppearance(events, 2.04);
  assert.equal(transition.type, 'text');
  assert.ok(transition.blend > 0.49 && transition.blend < 0.51);
  assert.equal(cursorAppearance([], 5).type, 'arrow');
});

test('quality is explicit and capture resolution is bounded before browser launch', () => {
  const plan = { url: 'https://example.com', steps: [{ action: 'wait' }] };
  assert.equal(validatePlan(plan).captureScale, 2);
  for (const captureScale of [0, 4, Infinity, '2']) assert.throws(() => validatePlan({ ...plan, captureScale }), /captureScale/);
  assert.throws(() => validatePlan({ ...plan, captureScale: 3, viewport: { width: 3840, height: 2160 } }), /captureScale/);
  assert.equal(renderSettings().quality, 'high');
  assert.throws(() => renderSettings({ quality: 'unknown' }), /quality/);
});
