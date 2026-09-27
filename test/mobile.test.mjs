import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { validatePlan } from '../src/plan.mjs';
import { TouchRunner } from '../src/capture/touch.mjs';
import { Camera } from '../src/motion.mjs';
import { createDeviceFrame, deviceLayout } from '../src/render/device.mjs';
import { keyboardAt, keyboardFocuses, keyboardSpans, liftedTouches } from '../src/render/keyboard.mjs';
import { paceTimeline } from '../src/render/pacing.mjs';
import { drawTouches, touchesAt, TouchTrack } from '../src/render/touch.mjs';
import { renderTracks } from '../src/render/tracks.mjs';
import { render } from '../src/render.mjs';

const plan = extra => validatePlan({ url: 'https://example.com', steps: [{ action: 'tap', selector: '#go' }], ...extra });
const iphone = plan({ device: 'iPhone 15 Pro' }).device;

test('a phone plan takes its viewport from the screen, between the status bar and the home indicator', () => {
  const { viewport, captureScale, device, steps } = plan({ device: 'iPhone 15 Pro' });
  assert.deepEqual(device, { name: 'iPhone 15 Pro', kind: 'iphone', screen: { width: 393, height: 852 }, insets: { top: 54, bottom: 34 } });
  assert.deepEqual(viewport, { width: 393, height: 764 });
  assert.equal(captureScale, 3);
  assert.equal(steps[0].action, 'click');
  assert.equal(plan({ device: 'Pixel 7' }).device.kind, 'android');
});

test('phone plans reject tablets, home-button iPhones, unknown names and a conflicting viewport', () => {
  for (const device of ['iPad Pro 11', 'iPhone 8', 'iPhone 15 Pro landscape', 'Nokia 3310', 42]) assert.throws(() => plan({ device }), /device/);
  assert.throws(() => plan({ device: 'iPhone 15 Pro', viewport: { width: 400, height: 800 } }), /viewport/);
});

test('swipe is a scroll and hold is a long press on a tap', () => {
  const { steps } = validatePlan({ url: 'https://example.com', steps: [{ action: 'swipe', y: 300 }, { action: 'tap', selector: '#a', hold: 0.7 }] });
  assert.deepEqual(steps.map(step => step.action), ['scroll', 'click']);
  for (const hold of [0.01, 9, '1']) {
    assert.throws(() => validatePlan({ url: 'https://example.com', steps: [{ action: 'tap', selector: '#a', hold }] }), /hold/);
  }
  assert.throws(() => validatePlan({ url: 'https://example.com', steps: [{ action: 'type', selector: '#a', text: 'x', hold: 1 }] }), /hold/);
});

function touchRunner(time = () => 1) {
  const sent = [];
  const session = { send: async (method, params) => sent.push({ method, ...params }) };
  const page = { viewportSize: () => ({ width: 393, height: 764 }), evaluate: async () => true };
  const timeline = { points: [], clicks: [], scrolls: [], focuses: [] };
  return { runner: new TouchRunner(page, timeline, time, session), sent, timeline };
}

test('a tap holds the finger down on the glass and is kept for the touch indicator', async () => {
  let time = 1;
  const { runner, sent, timeline } = touchRunner(() => time);
  runner.pointer = { x: 120, y: 300 };
  const pressing = runner.press(0.05);
  time = 1.08;
  await pressing;
  assert.deepEqual(sent.filter(event => event.method === 'Input.dispatchTouchEvent').map(event => event.type), ['touchStart', 'touchEnd']);
  assert.deepEqual(sent[0].touchPoints[0], { x: 120, y: 300, radiusX: 11, radiusY: 11 });
  assert.deepEqual(timeline.touches, [{ t: 1, up: 1.08, points: [{ t: 1, x: 120, y: 300 }] }]);
});

test('what a tap sets off animates 4× slower while captured and is kept as slow motion until it settles', async () => {
  let time = 1;
  const { runner, sent, timeline } = touchRunner(() => time);
  const pressing = runner.press(0.01);
  time = 1.1;
  await pressing;
  const order = sent.map(event => event.type ?? event.playbackRate);
  assert.deepEqual(order, ['touchStart', 0.25, 'touchEnd'], 'slowed before the finger lifts and the click fires');
  time = 2.3;
  await runner.settled();
  assert.equal(sent.at(-1).playbackRate, 1);
  assert.deepEqual(timeline.slowMotion, [{ start: 1.1, end: 2.3, factor: 4 }]);
  await runner.settled();
  assert.equal(timeline.slowMotion.length, 1, 'settling twice records one span');
});

test('a drag moves the finger past the touch slop, eases to rest and records a slow-motion span', async () => {
  const { runner, sent, timeline } = touchRunner();
  await runner.drag(200, { x: 0, y: 0, width: 393, height: 764 }, 0, 0.05);
  const moves = sent.filter(event => event.type === 'touchMove').map(event => event.touchPoints[0]);
  const start = sent[0].touchPoints[0];
  assert.equal(sent[0].type, 'touchStart');
  assert.equal(sent.at(-1).type, 'touchEnd');
  assert.ok(Math.abs(start.y - moves.at(-1).y - 215) < 1e-9, 'scrolling down drags the finger up, 15 px farther');
  assert.equal(timeline.touches[0].points.length, moves.length + 1);
  assert.equal(timeline.slowMotion[0].factor, 4);
});

test('a scroll longer than a comfortable stroke becomes several drags', async () => {
  const { runner } = touchRunner();
  const drags = [];
  runner.drag = async dy => drags.push(dy);
  await runner.swipe(-1000, { x: 0, y: 0, width: 393, height: 500 });
  assert.equal(drags.length, 3, 'strokes of at most 75% of the area');
  assert.ok(drags.every(dy => Math.abs(dy + 1000 / 3) < 1e-9));
});

test('a drag starts where the finger sets nothing off', async () => {
  const { runner, sent } = touchRunner();
  // Only the right side of the screen is quiet, as when a chart fills the middle.
  runner.page.evaluate = async (_, point) => point.x > 250;
  await runner.drag(100, { x: 0, y: 0, width: 393, height: 764 }, 0, 0.05);
  assert.ok(sent[0].touchPoints[0].x > 250);
});

test('a table wider than the screen is dragged sideways along the target row', async () => {
  const { runner, sent } = touchRunner();
  await runner.drag(240, { x: 17, y: 400, width: 359, height: 40 }, 0, 0.05, 'x');
  const points = sent.filter(event => event.method === 'Input.dispatchTouchEvent' && event.touchPoints.length)
    .map(event => event.touchPoints[0]);
  assert.ok(Math.abs(points[0].x - points.at(-1).x - 255) < 1e-9, 'scrolling right drags the finger left, 15 px farther');
  assert.ok(points.every(point => Math.abs(point.y - 420) < 20), 'the finger stays on the row');
});

test('a touch indicator lands, follows the finger and fades out after it lifts', () => {
  const touches = [{ t: 1, up: 1.1, points: [{ t: 1, x: 50, y: 50 }] },
    { t: 2, up: 2.5, points: [{ t: 2, x: 100, y: 400 }, { t: 2.5, x: 100, y: 100 }] }];
  assert.deepEqual(touchesAt(touches, 0.99), []);
  assert.ok(touchesAt(touches, 1.01)[0].alpha < 0.5, 'grows in');
  assert.equal(touchesAt(touches, 1.2)[0].alpha, 1, 'lingers after the finger lifts');
  assert.ok(touchesAt(touches, 1.4)[0].alpha < 1 && touchesAt(touches, 1.4)[0].scale > 1, 'fades while spreading');
  assert.deepEqual(touchesAt(touches, 1.6), []);
  const dragging = touchesAt(touches, 2.25)[0];
  assert.ok(dragging.y < 400 && dragging.y > 100);
  const frame = new TouchTrack({ touches }, 60).update(2.25).touches[0];
  assert.ok(frame.py > frame.y, 'the previous position feeds motion blur');
});

test('the touch indicator reads on white and on black pages', () => {
  for (const background of ['#ffffff', '#000000']) {
    const canvas = createCanvas(80, 80);
    const context = canvas.getContext('2d');
    context.fillStyle = background;
    context.fillRect(0, 0, 80, 80);
    drawTouches(context, [{ x: 40, y: 40, alpha: 1, scale: 1 }], 1, 1);
    const inside = context.getImageData(40, 40, 1, 1).data[0];
    const ring = Math.min(...[18, 19, 20, 21].map(x => context.getImageData(40 + x, 40, 1, 1).data[0]));
    const contrast = background === '#ffffff' ? 255 - ring : inside;
    assert.ok(contrast > 40, `visible on ${background}`);
  }
});

test('the phone sits centered in a vertical video with the page inside its screen', () => {
  const viewport = { width: 393, height: 764 };
  const layout = deviceLayout(iphone, viewport);
  const { frame, window, ratio, bounds } = createDeviceFrame(1080, 1920, viewport, 0.09, layout);
  assert.ok(Math.abs(window.x + window.width / 2 - 540) < 1e-9 && Math.abs(window.y + window.height / 2 - 960) < 1e-9);
  assert.ok(Math.abs(window.height - 1920 * 0.82) < 1e-9, 'a tall phone fills the height inside the padding');
  assert.ok(Math.abs(frame.screen.y + 54 * ratio - frame.y) < 1e-9, 'the page starts below the status bar');
  assert.ok(Math.abs(frame.screen.y + frame.screen.height - 34 * ratio - frame.y - frame.height) < 1e-9);
  assert.deepEqual(bounds, layout.body);
});

test('a locked camera only travels vertically to a subject at the side', () => {
  const layout = deviceLayout(iphone, { width: 393, height: 764 });
  const camera = new Camera(393, 764, { bounds: layout.body, sceneWidth: 609, sceneHeight: 1083, lockX: true });
  let state;
  for (let i = 0; i < 180; i++) state = camera.update({ x: 10, y: 600, width: 60, height: 40, plannedZoom: 1.45, shot: 0 }, null, 1 / 60);
  assert.equal(state.x, layout.body.x + layout.body.width / 2);
  assert.ok(state.y > 500 && state.zoom > 1.4);
});

const typed = () => ({
  viewport: { width: 393, height: 764 }, device: iphone, keys: [{ t: 3.5, key: 'Enter' }],
  touches: [{ t: 2, up: 2.1, points: [{ t: 2, x: 200, y: 620 }] }, { t: 8, up: 8.1, points: [{ t: 8, x: 200, y: 300 }] }],
  focuses: [{ t: 1.9, action: 'type', typingStart: 2.5, interactionEnd: 2.8, end: 2.9, x: 20, y: 600, width: 353, height: 48, keyboard: 'text',
    keys: [{ t: 2.5, key: 'O' }, { t: 2.7, key: 'i' }] }],
});

test('the keyboard rises with the tap on the field, lifts a covered field and is gone before the next tap', () => {
  const timeline = typed();
  const [span] = keyboardSpans(timeline);
  assert.equal(span.open, 2.1);
  assert.equal(span.close, 3.75, 'stays for the return key');
  assert.equal(span.lifts[0].lift, 600 + 48 + 10 - (764 + 34 - 311));
  assert.equal(keyboardAt([span], 2.55).pressed, 'O');
  assert.equal(keyboardAt([span], 2.75).pressed, 'i');
  assert.equal(keyboardAt([span], 3).pressed, null);
  assert.equal(keyboardAt([span], 3.55).pressed, '\n');
  assert.equal(keyboardAt([span], 8), null);
  const [focus] = keyboardFocuses(timeline, [span]);
  assert.equal(focus.y, 600 - span.lifts[0].lift, 'the camera frames the lifted field together with the keyboard');
  assert.equal(focus.context.y + focus.context.height, 764 + 34);
});

// Two fields typed in a row: the first near the top, the second tapped at `y`.
function twoFields(y) {
  const field = (t, top, key) => ({ t, action: 'type', typingStart: t + 0.4, interactionEnd: t + 0.5, end: t + 0.6,
    x: 20, y: top, width: 353, height: 48, keyboard: 'text', keys: [{ t: t + 0.4, key }] });
  return {
    viewport: { width: 393, height: 764 }, device: iphone, keys: [],
    touches: [{ t: 1, up: 1.1, points: [{ t: 1, x: 200, y: 70 }] }, { t: 2, up: 2.1, points: [{ t: 2, x: 200, y: y + 20 }] }],
    focuses: [field(1, 50, 'a'), field(2, y, 'b')],
  };
}

test('typing on into a field the raised page shows keeps the keyboard up and moves to that field', () => {
  const timeline = twoFields(460);
  const spans = keyboardSpans(timeline);
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0].lifts.map(step => step.lift), [0, 460 + 48 + 10 - 487]);
  assert.equal(keyboardAt(spans, 1.5).lift, 0, 'the first field is not lifted while it is typed into');
  assert.equal(keyboardAt(spans, 2.6).lift, 460 + 48 + 10 - 487);
  const [first, second] = keyboardFocuses(timeline, spans);
  assert.equal(first.y, 50);
  assert.equal(second.y, 460 - (460 + 48 + 10 - 487));
});

test('a field tapped where the keyboard covers it gets the keyboard back after the tap, not over it', () => {
  const timeline = twoFields(690);
  const spans = keyboardSpans(timeline);
  assert.equal(spans.length, 2);
  assert.ok(spans[0].close + 0.25 <= 2, 'down before the finger lands');
  assert.equal(keyboardAt(spans, 2), null);
});

test('a tap made while the page is raised shows where the page showed it', () => {
  const timeline = twoFields(440);
  timeline.focuses[0].y = 600;
  timeline.touches[1].points[0].y = 460 - 151;
  const spans = keyboardSpans(timeline);
  const lift = keyboardAt(spans, 2).lift;
  assert.ok(lift > 100);
  assert.equal(liftedTouches(timeline.touches, spans)[1].points[0].y, 460 - 151 - lift);
  assert.equal(liftedTouches(timeline.touches, spans)[0].points[0].y, 70, 'the tap that opened the keyboard stays where the finger was');
});

test('digits typed right after words switch the same keyboard to its 123 plane', () => {
  const timeline = twoFields(460);
  timeline.focuses[1].keyboard = 'numbers';
  timeline.focuses[1].keys = [{ t: 2.4, key: '2' }];
  const spans = keyboardSpans(timeline);
  assert.equal(spans.length, 1, 'the keyboard stays up');
  assert.equal(keyboardAt(spans, 1.6).layout, 'text');
  assert.equal(keyboardAt(spans, 2.45).layout, 'numbers');
  assert.equal(keyboardAt(spans, 2.45).pressed, '2');
  timeline.focuses[1].keyboard = 'numeric';
  assert.equal(keyboardSpans(timeline).length, 2, 'a number pad is another keyboard');
});

test('the keyboard leaves before a tap that follows typing closely', () => {
  const timeline = typed();
  timeline.keys = [];
  timeline.touches[1].t = 3.5;
  const [span] = keyboardSpans(timeline);
  assert.ok(span.close + 0.25 <= 3.5 - 0.04);
});

test('slow-motion drags play back at real speed with their touches', () => {
  const source = {
    duration: 6, frames: [{ t: 0 }], points: [], clicks: [], focuses: [], steps: [], keys: [],
    scrolls: [{ start: 1, end: 5, automatic: false }], slowMotion: [{ start: 1, end: 5, factor: 4 }],
    touches: [{ t: 1, up: 5, points: [{ t: 1, x: 0, y: 400 }, { t: 5, x: 0, y: 100 }] }],
  };
  const { timeline } = paceTimeline(source, 'original');
  assert.equal(timeline.touches[0].up, 2);
  assert.equal(timeline.touches[0].points[1].t, 2);
});

test('a phone recording frames subjects by height and keeps the whole screen width in view', () => {
  const timeline = {
    ...typed(), duration: 10, scrolls: [], clicks: [{ t: 2, up: 2.1, x: 200, y: 620 }],
    points: [{ t: 1.5, x: 196, y: 535 }, { t: 1.9, x: 200, y: 620 }], input: 'touch',
  };
  const layout = deviceLayout(iphone, timeline.viewport);
  const { ratio, scene, bounds } = createDeviceFrame(1080, 1920, timeline.viewport, 0.09, layout);
  const { frames, shots } = renderTracks(timeline, { scene, level: 1.5, fps: 30, bounds, ratio, width: 1080, height: 1920, keyboard: true });
  assert.ok(shots.length >= 1);
  assert.ok(Math.max(...frames.map(frame => frame.camera.zoom)) <= scene.width / (393 + 16) + 1e-9, 'never crops the screen sideways');
  assert.equal(new Set(frames.map(frame => frame.camera.x)).size, 1);
  assert.ok(frames.some(frame => frame.keyboard?.shown === 1));
  assert.ok(frames.some(frame => frame.cursor.touches.length));
});

const ffmpegReady = spawnSync('ffprobe', ['-version']).status === 0;

test('a phone recording exports as a vertical video with the phone drawn around the page', { skip: !ffmpegReady }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-screen-test-'));
  try {
    await mkdir(join(dir, 'frames'));
    const canvas = createCanvas(393, 764);
    const context = canvas.getContext('2d');
    context.fillStyle = '#f4f4f6';
    context.fillRect(0, 0, 393, 764);
    await writeFile(join(dir, 'frames/0.png'), await canvas.encode('png'));
    await writeFile(join(dir, 'timeline.json'), JSON.stringify({
      version: 1, viewport: { width: 393, height: 764 }, capture: { scale: 1, format: 'png' }, device: iphone, input: 'touch',
      frames: [{ t: 0, file: 'frames/0.png' }], points: [], clicks: [{ t: 0.5, up: 0.6, x: 200, y: 400 }],
      touches: [{ t: 0.5, up: 0.6, points: [{ t: 0.5, x: 200, y: 400 }] }],
      focuses: [], steps: [], scrolls: [], cursors: [], keys: [], duration: 1.5, status: 'complete',
    }));
    const report = await render(dir, { width: 360, height: 640, fps: 24, preset: 'pearl', workers: 1 });
    assert.equal(report.settings.window, 'device');
    const frame = spawnSync('ffmpeg', ['-v', 'error', '-ss', '0.1', '-i', join(dir, 'video.mp4'), '-frames:v', '1',
      '-vf', 'format=rgb24', '-f', 'rawvideo', '-']).stdout;
    const pixel = (x, y) => [...frame.subarray((Math.round(y) * 360 + x) * 3, (Math.round(y) * 360 + x) * 3 + 3)];
    const layout = deviceLayout(iphone, { width: 393, height: 764 });
    const { frame: screen, ratio } = createDeviceFrame(360, 640, { width: 393, height: 764 }, 0.09, layout);
    assert.ok(pixel(180, screen.y + screen.height / 2).every(value => value > 225), 'the page fills the screen');
    assert.ok(pixel(180, screen.screen.y + 29.5 * ratio).every(value => value < 40), 'the Dynamic Island sits at the top of the screen');
    assert.ok(pixel(10, 320).some(value => value < 225), 'the wallpaper shows around the phone');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('the device window needs a phone recording', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-screen-test-'));
  try {
    await writeFile(join(dir, 'timeline.json'), JSON.stringify({ status: 'complete', frames: [{ t: 0 }], viewport: { width: 1440, height: 810 } }));
    await assert.rejects(render(dir, { window: 'device' }), /phone/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
