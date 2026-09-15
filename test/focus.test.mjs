import test from 'node:test';
import assert from 'node:assert/strict';
import { focusWindows, planFocusZooms, renewFocus, exportDuration } from '../src/render/focus.mjs';
import { CursorVisibility } from '../src/render/cursor.mjs';
import { Camera, pointerAt } from '../src/motion.mjs';

test('a long request after a click does not hold zoom until the request finishes', () => {
  const [focus] = focusWindows({ focuses: [
    { t: 1, end: 20, action: 'click', x: 100, y: 100, width: 80, height: 30 },
  ], clicks: [{ t: 1.2 }] });
  assert.ok(Math.abs(focus.releaseAt - 3.6) < 1e-9);
  const camera = new Camera(1440, 900);
  for (let i = 0; i < 360; i++) camera.update(i / 60 <= focus.releaseAt ? focus : null, null, 1 / 60);
  assert.ok(camera.zoom < 1.001);
});

test('typing uses actual interaction end while manual focus honors its requested duration', () => {
  const [typing, manual] = focusWindows({ focuses: [
    { t: 1, end: 20, interactionEnd: 4, action: 'type' },
    { t: 21, end: 26, interactionEnd: 24, action: 'focus', manual: true },
  ], clicks: [] });
  assert.equal(typing.releaseAt, 6.4);
  assert.equal(manual.releaseAt, 28);
});

test('cursor interpolation is continuous at samples and stays at the click target', () => {
  const points = [{ t: 0, x: 0, y: 0 }, { t: 0.1, x: 20, y: 40 },
    { t: 0.3, x: 100, y: 80 }, { t: 0.5, x: 110, y: 90 }, { t: 2, x: 110, y: 90 }];
  const epsilon = 1e-5;
  const at = time => pointerAt(points, time).pointer;
  for (const point of points) {
    assert.equal(at(point.t).x, point.x);
    assert.equal(at(point.t).y, point.y);
  }
  for (const t of [0.1, 0.3, 0.5]) {
    const left = (at(t).x - at(t - epsilon).x) / epsilon;
    const right = (at(t + epsilon).x - at(t).x) / epsilon;
    assert.ok(Math.abs(left - right) < 0.1);
  }
  for (let t = 0; t < 2; t += 0.001) {
    assert.ok(at(t).x >= 0 && at(t).x <= 110);
    assert.ok(at(t).y >= 0 && at(t).y <= 90);
  }
  assert.equal(at(1).x, 110);
});

test('brief gaps connect close-ups but genuine idle periods still zoom out', () => {
  const make = t => ({ t, end: t + 0.1, action: 'click', x: 100, y: 100, width: 80, height: 30 });
  const windows = focusWindows({ focuses: [make(1), make(4), make(10)], clicks: [{ t: 1 }, { t: 4 }, { t: 10 }] });
  assert.ok(windows[0].releaseAt >= windows[1].t);
  assert.ok(windows[1].releaseAt < 7);
});

test('nearby click and typing share zoom without sacrificing room for a large field', () => {
  const target = { t: 1, end: 2, releaseAt: 5, x: 600, y: 380, width: 180, height: 40 };
  const windows = planFocusZooms([{ ...target, action: 'click' },
    { ...target, t: 3, action: 'type' },
    { ...target, t: 10, width: 1000, action: 'type' }], { width: 1440, height: 900 }, 1.8);
  assert.equal(windows[0].plannedZoom, windows[1].plannedZoom);
  assert.equal(windows[2].plannedZoom, 1);
});

test('zoom balances responsiveness with a gradual arrival', () => {
  const camera = new Camera(1440, 900);
  const focus = { x: 650, y: 420, width: 100, height: 40, action: 'click' };
  for (let i = 0; i < 30; i++) camera.update(focus, null, 1 / 60);
  assert.ok(camera.zoom > 1.25 && camera.zoom < 1.3);
  for (let i = 0; i < 150; i++) camera.update(focus, null, 1 / 60);
  assert.ok(Math.abs(camera.zoom - 1.35) < 0.001);
});

test('camera anticipation waits for visible targets and preserves an explicit focus', () => {
  const windows = focusWindows({ focuses: [
    { t: 1, end: 3, action: 'focus', manual: true },
    { t: 3.2, readyAt: 3.1, end: 3.3, action: 'click' },
  ], clicks: [{ t: 3.25 }] });
  assert.equal(windows[1].startAt, 3.1);
  const legacy = focusWindows({ focuses: [
    { t: 1, end: 3, action: 'focus', manual: true },
    { t: 3.2, end: 3.3, action: 'click' },
  ], clicks: [] });
  assert.equal(legacy[1].startAt, 3);
});

test('moving toward the next action does not revive an expired camera target', () => {
  const focus = { t: 1, releaseAt: 3.4, manual: false };
  renewFocus(focus, 5, 100);
  assert.equal(focus.releaseAt, 3.4);
  renewFocus(focus, 3, 100);
  assert.equal(focus.releaseAt, 5.4);
});

test('cursor returns progressively after idle and reaches full visibility', () => {
  const visibility = new CursorVisibility();
  for (let i = 0; i < 300; i++) visibility.update(i / 60, false, 1 / 60);
  assert.ok(visibility.opacity < 0.001);
  assert.ok(visibility.update(5, true, 1 / 60) < 0.4);
  for (let i = 1; i <= 20; i++) visibility.update(5 + i / 60, true, 1 / 60);
  assert.ok(visibility.opacity > 0.99);
});

test('ending reserves settling time only when a closing close-up needs it', () => {
  assert.equal(exportDuration({ duration: 10 }, [{ releaseAt: 9.7, plannedZoom: 1.35 }], 1.8), 11.2);
  assert.equal(exportDuration({ duration: 14 }, [{ releaseAt: 9.7, plannedZoom: 1.35 }], 1.8), 14);
  assert.equal(exportDuration({ duration: 10 }, [{ releaseAt: 9.7, plannedZoom: 1 }], 1.8), 10);
  assert.equal(exportDuration({ duration: 10 }, [], 1), 10);
});

test('a connected cluster shares its final scale across all actions', () => {
  const target = { x: 600, y: 380, width: 100, height: 40, end: 4, releaseAt: 6 };
  const windows = planFocusZooms([
    { ...target, t: 1, action: 'type' },
    { ...target, t: 2, action: 'click' },
    { ...target, t: 3, action: 'focus', manual: true },
  ], { width: 1440, height: 900 }, 1.8);
  assert.deepEqual(windows.map(focus => focus.plannedZoom), [1.3, 1.3, 1.3]);
});
