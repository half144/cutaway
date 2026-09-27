import test from 'node:test';
import assert from 'node:assert/strict';
import { movementDuration } from '../src/capture/pacing.mjs';
import { Camera, pointerAt, pointerPath, targetPoint } from '../src/motion.mjs';
import { validatePlan } from '../src/plan.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const speeds = path => path.slice(1).map((point, i) => distance(point, path[i]) / (point.t - path[i].t));

test('pointer arrives exactly at the target and slows down at both ends', () => {
  const from = { x: 50, y: 300 };
  const to = { x: 1100, y: 200 };
  const path = pointerPath(from, to, 1);
  assert.deepEqual(path[0], { t: 0, ...from });
  assert.deepEqual(path.at(-1), { t: 1, ...to });
  const v = speeds(path);
  const peak = Math.max(...v);
  assert.ok(v[0] < peak / 8);
  assert.ok(v.at(-1) < peak / 8);
});

test('speed peaks early and decelerates for longer, like an aimed hand movement', () => {
  const v = speeds(pointerPath({ x: 0, y: 0 }, { x: 150, y: 60 }, 0.6));
  const peakAt = v.indexOf(Math.max(...v)) / v.length;
  assert.ok(peakAt > 0.3 && peakAt < 0.47, `peak at ${peakAt}`);
});

test('a long stroke to a small target lands short and corrects within 120 ms; a large one takes one clean stroke', () => {
  const path = pointerPath({ x: 0, y: 0 }, { x: 800, y: 0 }, 1, { seed: 6, targetWidth: 16 });
  assert.ok(Math.max(...path.map(point => point.x)) <= 800);
  const beforeCorrection = path.find(point => point.t >= 0.88);
  assert.ok(beforeCorrection.x > 760 && beforeCorrection.x < 797);
  assert.deepEqual(path.at(-1), { t: 1, x: 800, y: 0 });
  const clean = pointerPath({ x: 0, y: 0 }, { x: 800, y: 0 }, 1, { seed: 6, targetWidth: 120 });
  const v = speeds(clean);
  const peak = Math.max(...v);
  const creeping = v.slice(v.indexOf(peak)).filter(speed => speed < peak * 0.15).length / 60;
  assert.ok(creeping <= 0.16, `slow tail ${creeping}s`);
});

test('strokes follow a visible, consistent arc instead of a straight line or random sides', () => {
  for (const seed of [0, 1, 2, 3, 4]) {
    for (const [from, to] of [[{ x: 0, y: 400 }, { x: 900, y: 400 }], [{ x: 900, y: 400 }, { x: 0, y: 400 }]]) {
      const path = pointerPath(from, to, 0.8, { seed });
      const bow = Math.min(...path.map(point => point.y - 400));
      assert.ok(Math.max(...path.map(point => point.y - 400)) <= 1e-9, 'horizontal strokes bow upward');
      assert.ok(-bow > 900 * 0.035 && -bow < 900 * 0.075, `deviation ${-bow}`);
    }
  }
});

test('pointer motion is deterministic but varies between gestures', () => {
  const from = { x: 40, y: 700 };
  const to = { x: 1200, y: 180 };
  assert.deepEqual(pointerPath(from, to, 1, { seed: 3 }), pointerPath(from, to, 1, { seed: 3 }));
  assert.notDeepEqual(pointerPath(from, to, 1, { seed: 3 }), pointerPath(from, to, 1, { seed: 4 }));
});

test('click landing points stay inside the target and avoid mechanical centering', () => {
  const box = { x: 100, y: 200, width: 160, height: 44 };
  const points = [0, 1, 2].map(seed => targetPoint(box, seed));
  for (const point of points) {
    assert.ok(point.x > box.x && point.x < box.x + box.width);
    assert.ok(point.y > box.y && point.y < box.y + box.height);
  }
  assert.notDeepEqual(points[0], points[1]);
});

test('movement timing follows target difficulty and keeps long strokes readable', () => {
  assert.ok(movementDuration(900, 24) > movementDuration(120, 120));
  assert.ok(movementDuration(500, 24) > movementDuration(500, 180));
  assert.ok(movementDuration(5000, 5) <= 1.3);
  const long = pointerPath({ x: 0, y: 0 }, { x: 1000, y: 0 }, movementDuration(1000, 200));
  assert.ok(Math.max(...speeds(long)) < 2600);
});

const at = zoom => ({ x: 650, y: 380, width: 120, height: 40, plannedZoom: zoom, shot: 1 });

test('zoom leaves promptly without a single-frame kick and settles like Screen Studio', () => {
  const camera = new Camera(1440, 810);
  const trace = [];
  for (let i = 0; i < 120; i++) trace.push(camera.update(at(1.8), null, 1 / 60).zoom);
  const progress = zoom => Math.log(zoom) / Math.log(1.8);
  assert.ok(progress(trace[0]) < 0.01, 'first frame barely moves');
  const half = trace.findIndex(zoom => progress(zoom) >= 0.5) / 60;
  const settled = trace.findIndex(zoom => progress(zoom) >= 0.99) / 60;
  assert.ok(half > 0.2 && half < 0.4, `50% at ${half}s`);
  assert.ok(settled > 0.8 && settled < 1.2, `99% at ${settled}s`);
  assert.ok(Math.max(...trace) <= 1.8 + 1e-9);
});

test('from the overview the zoom grows straight into its subject, and zooming out recedes from it', () => {
  const camera = new Camera(1440, 810, { sceneWidth: 1837, sceneHeight: 1033 });
  const subject = { x: 1200, y: 200, width: 100, height: 40, plannedZoom: 1.8, shot: 1 };
  const offsets = [(subject.x + 50 - camera.x) * camera.zoom];
  for (let i = 0; i < 90; i++) {
    camera.update(subject, null, 1 / 60);
    offsets.push((subject.x + 50 - camera.x) * camera.zoom);
  }
  const steps = offsets.slice(1).map((offset, i) => offset - offsets[i]);
  assert.ok(steps.every(step => step >= -0.01) || steps.every(step => step <= 0.01), 'no back-and-forth on screen');
  const heldX = camera.x;
  camera.update(null, null, 1 / 60);
  const panRatio = (camera.x - 720) / camera.rangeX(camera.zoom);
  assert.ok(Math.abs(panRatio - (heldX - 720) / camera.rangeX(1.8)) < 0.05, 'zoom-out keeps the framing');
  for (let i = 0; i < 120; i++) camera.update(null, null, 1 / 60);
  assert.ok(Math.abs(camera.zoom - 1) < 1e-3 && Math.abs(camera.x - 720) < 0.5);
});

test('near an edge the camera stays in the padded canvas and close-ups reveal only a sliver of wallpaper', () => {
  const scene = { width: 1837, height: 1076 };
  const camera = new Camera(1440, 810, { top: -40, sceneWidth: scene.width, sceneHeight: scene.height });
  for (const focus of [{ x: 5, y: 5, width: 60, height: 30 }, { x: 1370, y: 770, width: 60, height: 30 }]) {
    for (let i = 0; i < 240; i++) {
      const state = camera.update({ ...focus, plannedZoom: 1.8, shot: focus.x }, null, 1 / 60);
      const view = { width: scene.width / state.zoom, height: scene.height / state.zoom };
      const bleed = {
        left: -(state.x - view.width / 2), right: state.x + view.width / 2 - 1440,
        top: -40 - (state.y - view.height / 2), bottom: state.y + view.height / 2 - 810,
      };
      assert.ok(bleed.left <= camera.padX + 1e-6 && bleed.right <= camera.padX + 1e-6);
      assert.ok(bleed.top <= camera.padY + 1e-6 && bleed.bottom <= camera.padY + 1e-6);
      if (state.zoom > 1.5) {
        assert.ok(Math.max(bleed.left, bleed.right) <= view.width * 0.11);
        assert.ok(Math.max(bleed.top, bleed.bottom) <= view.height * 0.11);
      }
    }
  }
});

test('camera does not follow small cursor movements inside its safe region', () => {
  const camera = new Camera(1440, 900);
  const focus = { x: 600, y: 380, width: 200, height: 40, plannedZoom: 1.8, shot: 1 };
  for (let i = 0; i < 180; i++) camera.update(focus, { x: 700, y: 400 }, 1 / 60);
  const initialX = camera.targetX;
  const initialY = camera.targetY;
  for (let i = 0; i < 100; i++) camera.update(focus, { x: 700 + Math.sin(i) * 45, y: 400 + Math.cos(i) * 30 }, 1 / 60);
  assert.equal(camera.targetX, initialX);
  assert.equal(camera.targetY, initialY);
});

test('camera spring gives the same framing at different export frame rates', () => {
  const positions = [30, 60].map(fps => {
    const camera = new Camera(1440, 900);
    for (let i = 0; i < fps; i++) camera.update(at(1.8), null, 1 / fps);
    return camera;
  });
  assert.ok(Math.abs(positions[0].zoom - positions[1].zoom) < 1e-8);
  assert.ok(Math.abs(positions[0].x - positions[1].x) < 1e-8);
});

test('switching subjects mid-shot pans without velocity jumps', () => {
  const camera = new Camera(1440, 900);
  for (let i = 0; i < 180; i++) camera.update({ x: 40, y: 495, width: 257, height: 62, plannedZoom: 1.8, shot: 1 }, null, 1 / 60);
  let previous = { x: camera.x, y: camera.y };
  let velocity = { x: 0, y: 0 };
  for (let i = 0; i < 180; i++) {
    const state = camera.update({ x: 1100, y: 232, width: 200, height: 60, plannedZoom: 1.8, shot: 1 }, null, 1 / 60);
    const next = { x: state.x - previous.x, y: state.y - previous.y };
    assert.ok(Math.hypot(next.x - velocity.x, next.y - velocity.y) < 4);
    previous = state;
    velocity = next;
  }
});

test('cursor interpolation is continuous at samples and stays at the click target', () => {
  const points = [{ t: 0, x: 0, y: 0 }, { t: 0.1, x: 20, y: 40 },
    { t: 0.3, x: 100, y: 80 }, { t: 0.5, x: 110, y: 90 }, { t: 2, x: 110, y: 90 }];
  const epsilon = 1e-5;
  const sample = time => pointerAt(points, time).pointer;
  for (const point of points) {
    assert.equal(sample(point.t).x, point.x);
    assert.equal(sample(point.t).y, point.y);
  }
  for (const t of [0.1, 0.3, 0.5]) {
    const left = (sample(t).x - sample(t - epsilon).x) / epsilon;
    const right = (sample(t + epsilon).x - sample(t).x) / epsilon;
    assert.ok(Math.abs(left - right) < 0.1);
  }
  assert.equal(sample(1).x, 110);
});

test('pointer sampling holds still through pauses and interpolates movement', () => {
  const points = [{ t: 0, x: 10, y: 10 }, { t: 2, x: 10, y: 10 }, { t: 3, x: 30, y: 40 }];
  assert.equal(pointerAt(points, 1).pointer.x, 10);
  assert.equal(pointerAt(points, 2.5).pointer.x, 20);
  assert.equal(pointerAt(points, 9).pointer.x, 30);
});

test('invalid actions and non-finite timing fail before browser actions; the default viewport is 16:9', () => {
  const base = { url: 'https://example.com' };
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'delete' }] }), /unsupported/);
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'wait', duration: -1 }] }), /duration/);
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'type', selector: '#name' }] }), /text/);
  assert.deepEqual(validatePlan({ ...base, steps: [{ action: 'wait' }] }).viewport, { width: 1440, height: 810 });
});
