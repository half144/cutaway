import test from 'node:test';
import assert from 'node:assert/strict';
import { movementDuration } from '../src/capture/pacing.mjs';
import { Camera, focusZoom, pointerAt, pointerPath, targetPoint } from '../src/motion.mjs';
import { validatePlan } from '../src/plan.mjs';

test('pointer arrives exactly at the target and slows down at both ends', () => {
  const from = { x: 50, y: 300 };
  const to = { x: 1100, y: 200 };
  const path = pointerPath(from, to, 1);
  assert.deepEqual(path[0], { t: 0, ...from });
  assert.ok(Math.hypot(path.at(-1).x - to.x, path.at(-1).y - to.y) < 1e-8);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(distance(path[0], path[1]) < distance(path[29], path[30]) / 50);
  assert.ok(distance(path.at(-1), path.at(-2)) < distance(path[29], path[30]) / 50);
});

test('pointer motion is deterministic but varies its path between gestures', () => {
  const from = { x: 40, y: 700 };
  const to = { x: 1200, y: 180 };
  const first = pointerPath(from, to, 1, { seed: 3, targetWidth: 40 });
  const repeated = pointerPath(from, to, 1, { seed: 3, targetWidth: 40 });
  const different = pointerPath(from, to, 1, { seed: 4, targetWidth: 40 });
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, different);
  assert.deepEqual(first.at(-1), { t: 1, ...to });
});

test('long pointer moves settle laterally without overshooting the target', () => {
  const path = pointerPath({ x: 0, y: 0 }, { x: 800, y: 0 }, 1, { seed: 6, targetWidth: 40 });
  assert.ok(Math.max(...path.map(point => point.x)) <= 800);
  assert.ok(path.slice(-12, -1).some(point => Math.abs(point.y) > 0.1));
  assert.ok(Math.max(...path.map(point => Math.abs(point.y))) < 80);
  assert.deepEqual(path.at(-1), { t: 1, x: 800, y: 0 });
});

test('click landing points stay inside the target and avoid mechanical centering', () => {
  const box = { x: 100, y: 200, width: 160, height: 44 };
  const points = [0, 1, 2].map(seed => targetPoint(box, seed));
  for (const point of points) {
    assert.ok(point.x > box.x && point.x < box.x + box.width);
    assert.ok(point.y > box.y && point.y < box.y + box.height);
  }
  assert.ok(points.some(point => point.x !== 180 || point.y !== 222));
  assert.notDeepEqual(points[0], points[1]);
});

test('movement timing follows distance and target difficulty', () => {
  assert.ok(movementDuration(900, 24) > movementDuration(120, 120));
  assert.ok(movementDuration(500, 24) > movementDuration(500, 180));
  assert.ok(movementDuration(5000, 5) <= 1.2);
});

test('camera does not follow small cursor movements inside its safe region', () => {
  const camera = new Camera(1440, 900);
  const focus = { x: 600, y: 380, width: 200, height: 40 };
  for (let i = 0; i < 180; i++) camera.update(focus, { x: 700, y: 400 }, 1 / 60);
  const initialX = camera.targetX;
  const initialY = camera.targetY;
  for (let i = 0; i < 100; i++) camera.update(focus, { x: 700 + Math.sin(i) * 45, y: 400 + Math.cos(i) * 30 }, 1 / 60);
  assert.equal(camera.targetX, initialX);
  assert.equal(camera.targetY, initialY);
});

test('camera never reveals pixels outside the recording when zooming near corners', () => {
  const camera = new Camera(1440, 900);
  for (const focus of [{ x: 5, y: 5, width: 60, height: 30 }, { x: 1350, y: 835, width: 60, height: 30 }, null]) {
    for (let i = 0; i < 240; i++) {
      const state = camera.update(focus, null, 1 / 60);
      assert.ok(state.x - 720 / state.zoom >= -1e-7);
      assert.ok(state.x + 720 / state.zoom <= 1440 + 1e-7);
      assert.ok(state.y - 450 / state.zoom >= -1e-7);
      assert.ok(state.y + 450 / state.zoom <= 900 + 1e-7);
      assert.ok(state.zoom >= 1 && state.zoom <= 1.8 + 1e-7);
    }
  }
  assert.ok(Math.abs(camera.zoom - 1) < 1e-6);
});

test('camera keeps large fields readable by reducing zoom', () => {
  const camera = new Camera(1440, 900);
  for (let i = 0; i < 240; i++) camera.update({ x: 200, y: 250, width: 1000, height: 400 }, null, 1 / 60);
  assert.ok(camera.zoom < 1.01);
});

test('camera spring gives the same framing at different export frame rates', () => {
  const focus = { x: 680, y: 300, width: 180, height: 40 };
  const positions = [30, 60].map(fps => {
    const camera = new Camera(1440, 900);
    for (let i = 0; i < fps; i++) camera.update(focus, null, 1 / fps);
    return camera;
  });
  assert.ok(Math.abs(positions[0].zoom - positions[1].zoom) < 1e-8);
  assert.ok(Math.abs(positions[0].x - positions[1].x) < 1e-8);
});

test('pointer sampling holds still through pauses and interpolates movement', () => {
  const points = [{ t: 0, x: 10, y: 10 }, { t: 2, x: 10, y: 10 }, { t: 3, x: 30, y: 40 }];
  assert.equal(pointerAt(points, 1).pointer.x, 10);
  assert.equal(pointerAt(points, 2.5).pointer.x, 20);
  assert.equal(pointerAt(points, 9).pointer.x, 30);
});

test('adaptive zoom distinguishes typing, clicks, and large surrounding regions', () => {
  const target = { x: 600, y: 300, width: 220, height: 40 };
  const zoom = focus => focusZoom(focus, 1440, 900, 1.8, 0.65);
  assert.ok(zoom({ ...target, action: 'type' }) > zoom({ ...target, action: 'click' }));
  assert.ok(zoom({ ...target, manual: true }) < zoom({ ...target, action: 'click' }));
  assert.ok(zoom({ ...target, context: { ...target, width: 800, height: 350 } }) < zoom(target));
  assert.equal(focusZoom(target, 1440, 900, 1, 0.65), 1);
});

test('invalid actions and non-finite timing fail before browser actions', () => {
  const base = { url: 'https://example.com' };
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'delete' }] }), /unsupported/);
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'wait', duration: -1 }] }), /duration/);
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'type', selector: '#name' }] }), /text/);
  assert.equal(validatePlan({ ...base, steps: [{ action: 'wait' }] }).viewport.width, 1440);
});

test('oversized offscreen focus cannot fling the camera across the viewport', () => {
  const camera = new Camera(1440, 900);
  const menu = { x: 342, y: 225, width: 164, height: 288 };
  for (let i = 0; i < 180; i++) camera.update(menu, null, 1 / 60);
  const table = { x: 333, y: -187.25, width: 9696, height: 25074, manual: true };
  let previous = { x: camera.x, y: camera.y };
  for (let i = 0; i < 180; i++) {
    const state = camera.update(table, null, 1 / 60);
    assert.ok(Math.hypot(state.x - previous.x, state.y - previous.y) < 25);
    previous = state;
  }
  assert.ok(Math.abs(camera.x - 720) < 0.001);
  assert.ok(Math.abs(camera.y - 450) < 0.001);
});

test('switching from an edge close-up to a wide focus decelerates without a position clamp', () => {
  const camera = new Camera(1440, 900);
  for (let i = 0; i < 180; i++) {
    camera.update({ x: 40, y: 495, width: 257, height: 62, action: 'type' }, null, 1 / 60);
  }
  let previous = { x: camera.x, y: camera.y };
  let velocity = { x: 0, y: 0 };
  for (let i = 0; i < 180; i++) {
    const state = camera.update({ x: 333, y: 232, width: 1082, height: 114, manual: true }, null, 1 / 60);
    const next = { x: state.x - previous.x, y: state.y - previous.y };
    assert.ok(Math.hypot(next.x - velocity.x, next.y - velocity.y) < 8);
    previous = state;
    velocity = next;
  }
});
