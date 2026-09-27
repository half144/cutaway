import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createFrame, drawOverlay, SceneRenderer } from '../src/render/scene.mjs';
import { cursorAppearance, cursorEvents, pressScale } from '../src/render/cursor.mjs';
import { drawKeys, keyEvents } from '../src/render/keys.mjs';
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
  const viewport = { width: 192, height: 192 };
  const renderer = new SceneRenderer(192, 192);
  renderer.renderPage({ ...viewport, viewport, source, backdrop: createCanvas(192, 192),
    frame: createFrame(192, 192, viewport, 0).frame, camera: { x: 96, y: 96, zoom: 2 } });
  const pixels = renderer.context.getImageData(20, 90, 150, 1).data;
  let contrast = 0;
  for (let i = 4; i < pixels.length; i += 4) contrast += Math.abs(pixels[i] - pixels[i - 4]);
  assert.ok(contrast / 149 > 240, 'one-pixel text-like detail must retain its contrast at 1:1 pixel mapping');
});

test('page cache reuses static pixels while cursor moves and invalidates for camera or source changes', () => {
  const viewport = { width: 192, height: 192 };
  const output = createCanvas(192, 192);
  const sample = { ...viewport, viewport, frame: createFrame(192, 192, viewport, 0.1).frame,
    source: createCanvas(384, 384), backdrop: createCanvas(192, 192),
    camera: { x: 96, y: 96, zoom: 1 }, cursor: { opacity: 1, rotation: 0, size: 1, pixels: 1, press: 1 },
    pointer: { x: 40, y: 40 } };
  const renderer = new SceneRenderer(192, 192);
  const draw = frame => {
    renderer.renderPage(frame);
    const context = output.getContext('2d');
    context.clearRect(0, 0, 192, 192);
    context.drawImage(renderer.page, 0, 0);
    drawOverlay(context, frame);
  };
  draw(sample);
  const first = Buffer.from(output.data());
  draw({ ...sample, pointer: { x: 80, y: 80 } });
  assert.equal(renderer.pageDraws, 1);
  assert.equal(renderer.cacheHits, 1);
  assert.notDeepEqual(output.data(), first);
  draw({ ...sample, camera: { ...sample.camera, zoom: 1.1 } });
  assert.equal(renderer.pageDraws, 2);
  draw({ ...sample, source: createCanvas(384, 384) });
  assert.equal(renderer.pageDraws, 3);
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

test('cursor types suppress fleeting changes and cross-fade over 0.2 s, with legacy fallback', () => {
  const events = cursorEvents({ cursors: [{ t: 0, type: 'arrow' }, { t: 1, type: 'hand' },
    { t: 1.03, type: 'arrow' }, { t: 2, type: 'text' }] });
  assert.ok(!events.some(event => event.type === 'hand'));
  const transition = cursorAppearance(events, 2.1);
  assert.equal(transition.type, 'text');
  assert.ok(transition.blend > 0.2 && transition.blend < 0.9);
  assert.equal(cursorAppearance(events, 2.2).blend, 1);
  assert.equal(cursorAppearance([], 5).type, 'arrow');
});

test('the pointer squeezes into a click, stays pressed briefly and springs back a touch past its size', () => {
  const clicks = [{ t: 1, up: 1.1 }];
  assert.equal(pressScale(clicks, 0.8), 1);
  assert.ok(pressScale(clicks, 0.94) < 1 && pressScale(clicks, 0.94) > 0.8);
  assert.ok(Math.abs(pressScale(clicks, 1.05) - 0.8) < 1e-9);
  assert.ok(pressScale(clicks, 1.215) > 1.02 && pressScale(clicks, 1.215) < 1.05, 'release overshoot');
  assert.equal(pressScale(clicks, 1.35), 1);
  assert.equal(pressScale([{ t: 1, up: 1.6 }], 1.4), 1, 'a release delayed by a busy page still reads as a brief tap');
});

test('shortcut overlay shows modifier combinations by default, like Screen Studio', () => {
  const timeline = { keys: [{ t: 1, key: 'Escape' }, { t: 2, key: 'ControlOrMeta+K' }] };
  assert.deepEqual(keyEvents(timeline, 'combos'), [{ t: 1, labels: ['esc'] }, { t: 2, labels: ['⌘', 'K'] }],
    'named keys show so their effect has a visible cause');
  assert.deepEqual(keyEvents({ keys: [{ t: 1, key: 'a' }] }, 'combos'), []);
  assert.equal(keyEvents({ keys: [{ t: 1, key: 'a' }] }, 'all').length, 1);
  assert.deepEqual(keyEvents(timeline, 'none'), []);
  assert.deepEqual(keyEvents({ keys: [{ t: 1, key: 'Control++' }] }, 'combos')[0].labels, ['⌃', '+']);
  const inked = time => {
    const canvas = createCanvas(320, 180);
    drawKeys(canvas.getContext('2d'), keyEvents(timeline, 'combos'), time, 320, 180);
    return canvas.data().some((value, index) => index % 4 === 3 && value > 0);
  };
  assert.equal(inked(2.5), true);
  assert.equal(inked(0.5), false);
  assert.equal(inked(8), false);
});

test('motion blur samples reuse one rasterization of the capture', () => {
  const viewport = { width: 192, height: 192 };
  const sample = { ...viewport, viewport, frame: createFrame(192, 192, viewport, 0.1).frame,
    source: createCanvas(384, 384), backdrop: createCanvas(192, 192), camera: { x: 96, y: 96, zoom: 1.5 } };
  const renderer = new SceneRenderer(192, 192);
  renderer.renderPage(sample);
  const direct = createCanvas(192, 192);
  renderer.renderPage(sample);
  renderer.drawPageAs(direct.getContext('2d'), sample);
  assert.equal(renderer.pageDraws, 1);
  assert.deepEqual(direct.data(), renderer.page.data());
});

test('quality is explicit and capture resolution is bounded before browser launch', () => {
  const plan = { url: 'https://example.com', steps: [{ action: 'wait' }] };
  assert.equal(validatePlan(plan).captureScale, 2);
  for (const captureScale of [0, 4, Infinity, '2']) assert.throws(() => validatePlan({ ...plan, captureScale }), /captureScale/);
  assert.throws(() => validatePlan({ ...plan, captureScale: 3, viewport: { width: 3840, height: 2160 } }), /captureScale/);
  assert.equal(renderSettings().quality, 'high');
  assert.throws(() => renderSettings({ quality: 'unknown' }), /quality/);
});
