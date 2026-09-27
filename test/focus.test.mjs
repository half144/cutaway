import test from 'node:test';
import assert from 'node:assert/strict';
import { exportDuration, planShots, shotTarget } from '../src/render/focus.mjs';
import { cameraDrags, hiddenSpans, keyboardTimes, visibilityAt } from '../src/render/cursor.mjs';
import { renderTracks } from '../src/render/tracks.mjs';

const scene = { width: 1837, height: 1033 };
const click = (t, extra = {}) => ({ t, readyAt: t - 0.5, end: t + 0.2, interactionEnd: t + 0.2,
  action: 'click', x: 600, y: 350, width: 120, height: 40, ...extra });
const plan = (timeline, level = 1.8) => planShots({ clicks: [], scrolls: [], ...timeline }, { scene, level });

test('clicks a few seconds apart share one continuous close-up instead of pumping', () => {
  const focuses = [click(1), click(4), click(6.5, { x: 700 })];
  const { shots } = plan({ focuses, clicks: focuses.map(focus => ({ t: focus.t + 0.15 })) });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].zoom, 1.8);
  assert.ok(Math.abs(shots[0].releaseAt - (6.65 + 1.8)) < 1e-9);
});

test('a genuine idle period zooms out between separate shots', () => {
  const focuses = [click(1), click(12)];
  const { shots } = plan({ focuses, clicks: focuses.map(focus => ({ t: focus.t + 0.15 })) });
  assert.equal(shots.length, 2);
  assert.ok(shots[1].startAt - shots[0].releaseAt > 2);
});

test('a long request after a click does not hold the close-up until it finishes', () => {
  const { shots } = plan({ focuses: [click(1, { end: 20 })], clicks: [{ t: 1.2 }] });
  assert.ok(Math.abs(shots[0].releaseAt - 3) < 1e-9);
});

test('a manual scroll releases the close-up first and the next shot waits for it to settle', () => {
  const focuses = [click(1), click(4.5)];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }, { t: 4.6 }], scrolls: [{ start: 2.6, end: 4.4 }] });
  assert.equal(shots.length, 2);
  assert.ok(shots[0].releaseAt <= 2.25 + 1e-9);
  assert.equal(shots[1].startAt, 4.4);
  const tooClose = plan({ focuses, clicks: [{ t: 1.1 }, { t: 4.6 }], scrolls: [{ start: 1.9, end: 4.4 }] });
  assert.equal(tooClose.shots.length, 1, 'no sub-second flash of zoom right before a scroll');
});

test('automatic scrolls keep the close-up and follow each target in turn', () => {
  const focuses = [click(1), click(3, { y: 500 })];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }, { t: 3.1 }], scrolls: [{ start: 1.8, end: 2.3, automatic: true }] });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].targets.length, 2);
  assert.equal(shotTarget(shots[0], 3).region.y, 500);
});

test('brief gaps between shots connect instead of zooming out and straight back in', () => {
  const focuses = [click(1), click(4.2, { x: 100 })];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }, { t: 4.3 }] });
  assert.equal(shots.length, 2);
  assert.equal(shots[0].releaseAt, shots[1].startAt);
});

test('the camera sets off with the pointer instead of waiting for it to arrive', () => {
  const points = [{ t: 0, x: 100, y: 700 }, { t: 0.5, x: 100, y: 700 }, { t: 0.9, x: 400, y: 500 }, { t: 1.4, x: 660, y: 370 }];
  const { shots } = plan({ focuses: [click(1.45, { readyAt: 0.45 })], clicks: [{ t: 1.6 }], points });
  assert.equal(shots[0].startAt, 0.5);
  const still = plan({ focuses: [click(1.45, { readyAt: 0.45 })], clicks: [{ t: 1.6 }], points: [{ t: 0, x: 660, y: 370 }] });
  assert.ok(Math.abs(still.shots[0].startAt - 1.3) < 1e-9, 'a click without travel is anticipated slightly');
});

test('a stroke made during the previous rest counts as the approach: the camera leaves with it', () => {
  const points = [{ t: 0, x: 100, y: 700 }, { t: 1, x: 100, y: 700 }, { t: 1.6, x: 660, y: 370 }, { t: 3, x: 660, y: 370 }];
  const { shots } = plan({ focuses: [click(3, { readyAt: 1, approachStart: 1 })], clicks: [{ t: 3.2 }], points });
  assert.equal(shots[0].startAt, 1, 'not when the hand has already been waiting on the target');
});

test('a close-up ending just before the hand leaves zooms out together with it', () => {
  const points = [{ t: 0, x: 660, y: 370 }, { t: 3.5, x: 660, y: 370 }, { t: 4.3, x: 1300, y: 700 }];
  const { shots } = plan({ focuses: [click(1)], clicks: [{ t: 1.1 }], points });
  assert.equal(shots[0].releaseAt, 3.5);
});

test('a wide text field is framed from its leading edge and the camera follows the caret', () => {
  const field = { t: 1, readyAt: 0.5, interactionEnd: 5, end: 5, action: 'type', x: 100, y: 400, width: 1200, height: 44,
    carets: [{ t: 2, x: 400, y: 410, height: 20 }, { t: 4, x: 1200, y: 410, height: 20 }] };
  const { shots } = plan({ focuses: [field], clicks: [{ t: 1.15 }] });
  const [shot] = shots;
  assert.ok(shot.zoom >= 1.4);
  assert.equal(shotTarget(shot, 1.5).region.x, 100);
  assert.ok(shotTarget(shot, 4.5).region.x > shotTarget(shot, 2.5).region.x);
});

test('a result near the control is framed with it; a click whose effect fills the screen keeps the overview', () => {
  const near = plan({ focuses: [click(1, { result: { t: 2, x: 600, y: 420, width: 200, height: 30 } })], clicks: [{ t: 1.1 }] });
  assert.equal(near.shots[0].targets.length, 1);
  assert.ok(near.shots[0].targets[0].region.height >= 100);
  assert.ok(near.shots[0].releaseAt >= 3.4 - 1e-9);
  const page = plan({ focuses: [click(1, { result: { t: 2, x: 0, y: 0, width: 1440, height: 810 } })], clicks: [{ t: 1.1 }] });
  assert.deepEqual(page.shots, [], 'no zoom in on a control only to widen out as its effect appears');
});

test('a tall manual focus is read from the top instead of being skipped', () => {
  const focus = { t: 1, readyAt: 1, end: 3, action: 'focus', manual: true, x: 300, y: 100, width: 700, height: 1400 };
  const { shots, report } = plan({ focuses: [focus] });
  assert.equal(report.skippedFocuses, 0);
  assert.ok(shots[0].zoom >= 1.2);
  assert.equal(shots[0].targets[0].region.y, 100);
  const wide = plan({ focuses: [{ ...focus, width: 2400 }] });
  assert.equal(wide.report.skippedFocuses, 1);
});

test('a focus too large to zoom holds the overview between close-ups', () => {
  const table = { t: 4, readyAt: 4, end: 6.5, action: 'focus', manual: true, x: 100, y: 100, width: 1300, height: 400 };
  const focuses = [click(2), table, click(7)];
  const { shots, report } = plan({ focuses, clicks: [{ t: 2.1 }, { t: 7.1 }] });
  assert.equal(report.skippedFocuses, 1);
  assert.equal(shots.length, 2);
  assert.ok(shots[0].releaseAt <= 4 - 0.35 + 1e-9);
  assert.ok(shots[1].startAt >= 6.5);
});

test('a large effect plays out on the overview; a slow one is revealed after the close-up', () => {
  const dialog = { x: 200, y: 50, width: 1100, height: 700 };
  const quick = plan({ focuses: [click(1, { result: { t: 2, ...dialog } }), click(3.6, { x: 700, y: 400, readyAt: 3.2 })],
    clicks: [{ t: 1.1 }, { t: 3.7 }] });
  assert.equal(quick.shots.length, 1, 'the click that opens the dialog is not zoomed');
  assert.ok(quick.shots[0].startAt >= 2.6 - 1e-9, 'the next close-up waits for the dialog to be seen');
  assert.equal(quick.shots[0].zoom, 1.8);
  const slow = plan({ focuses: [click(1, { result: { t: 3, ...dialog } }), click(4.6, { x: 700, y: 400 })],
    clicks: [{ t: 1.1 }, { t: 4.7 }] });
  assert.equal(slow.shots.length, 2);
  assert.ok(slow.shots[0].releaseAt <= 3.3 + 1e-9);
  assert.ok(slow.shots[0].releaseAt < slow.shots[1].startAt);
});

test('close-ups a few seconds apart on nearby subjects ease halfway out instead of back to the overview', () => {
  const focuses = [click(1), click(4.7, { x: 750 })];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }, { t: 4.8 }] });
  assert.equal(shots.length, 3);
  assert.ok(Math.abs(shots[1].zoom - 1.4) < 1e-9, 'halfway between 1× and 1.8×');
  assert.equal(shots[0].releaseAt, shots[1].startAt);
  assert.equal(shots[1].releaseAt, shots[2].startAt);
  const far = plan({ focuses: [click(1), click(4.7, { x: 50, y: 20 })], clicks: [{ t: 1.1 }, { t: 4.8 }] });
  assert.equal(far.shots.length, 2, 'distant subjects still return to the overview');
});

test('a reveal followed within a second by the next close-up pans straight on instead of pumping', () => {
  const table = { t: 3.3, x: 100, y: 100, width: 1200, height: 600 };
  const focuses = [click(1), click(2.6, { x: 640, result: table }), click(4.3, { x: 900, y: 200 })];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }, { t: 2.7 }, { t: 4.4 }] });
  assert.equal(shots.length, 2);
  assert.equal(shots[0].releaseAt, shots[1].startAt);
});

test('an action with a large effect right next to the close-up finishes zoomed, then widens', () => {
  const table = { t: 3.3, x: 100, y: 100, width: 1200, height: 600 };
  const focuses = [click(1), click(2.6, { x: 640, result: table })];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }, { t: 2.7 }] });
  assert.equal(shots.length, 1);
  assert.ok(Math.abs(shots[0].releaseAt - 3.6) < 1e-9);
});

test('a mid-size result widens in its own connected shot without lowering the earlier close-up', () => {
  const panel = { t: 3, x: 300, y: 500, width: 800, height: 60 };
  const focuses = [click(1), click(2, { result: panel }), click(5)];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }, { t: 2.1 }, { t: 5.1 }] });
  assert.equal(shots[0].zoom, 1.8);
  assert.ok(shots[1].zoom < 1.8 && shots[1].zoom > 1.25);
  assert.equal(shots[0].releaseAt, shots[1].startAt);
  assert.deepEqual(shotTarget(shots[1], 3).region, { x: 300, y: 500, width: 800, height: 60 });
  assert.equal(shots.length, 3);
});

test('actions without a dedicated hold and legacy focuses still plan finite shots', () => {
  const { shots } = plan({ focuses: [click(1, { action: 'press' }), click(9, { action: undefined })], clicks: [] });
  assert.equal(shots.length, 2);
  assert.ok(shots.every(shot => Number.isFinite(shot.startAt) && Number.isFinite(shot.releaseAt)));
  assert.ok(Number.isFinite(exportDuration({ duration: 12 }, shots)));
});

test('a low zoom level never zooms below 1× to fit a large target', () => {
  const { shots } = plan({ focuses: [click(1, { width: 1300 })], clicks: [{ t: 1.1 }] }, 1.1);
  assert.ok(shots.every(shot => shot.zoom >= 1.05));
});

test('the video opens on the whole page: a focus before the first gesture does not zoom in', () => {
  const title = { t: 1, readyAt: 1, end: 2.5, action: 'focus', manual: true, x: 200, y: 120, width: 300, height: 50 };
  const points = [{ t: 0, x: 700, y: 600 }, { t: 2.8, x: 700, y: 600 }, { t: 3.4, x: 660, y: 370 }];
  const { shots, report } = plan({ focuses: [title, click(3.45, { readyAt: 2.7 })], clicks: [{ t: 3.6 }], points });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].manual, undefined);
  assert.equal(shots[0].startAt, 2.8, 'the first zoom starts with the first gesture');
  assert.equal(report.skippedFocuses, 1);
  const late = plan({ focuses: [{ ...title, t: 4, readyAt: 4, end: 5.5 }], points: [{ t: 0, x: 700, y: 600 }, { t: 1, x: 700, y: 600 }, { t: 1.5, x: 600, y: 500 }] });
  assert.equal(late.shots[0].manual, true, 'a focus after the first gesture still zooms');
});

test('zoom can be disabled entirely', () => {
  assert.deepEqual(plan({ focuses: [click(1)], clicks: [{ t: 1.1 }] }, 1).shots, []);
});

test('the ending lets the final zoom-out settle and rests briefly on the overview', () => {
  assert.ok(Math.abs(exportDuration({ duration: 10 }, [{ releaseAt: 9.7, zoom: 1.8 }]) - 11.3) < 1e-9);
  assert.ok(Math.abs(exportDuration({ duration: 10 }, [{ releaseAt: 14, zoom: 1.8 }]) - 11.6) < 1e-9, 'content end releases the camera');
  assert.equal(exportDuration({ duration: 14 }, [{ releaseAt: 9.7, zoom: 1.8 }]), 14);
  assert.equal(exportDuration({ duration: 10 }, []), 10);
});

test('the result a shot reveals is framed straight away by a focus on it, without an overview in between', () => {
  const result = { t: 3, x: 100, y: 300, width: 1000, height: 20 };
  const focuses = [click(1, { result }),
    { t: 5, readyAt: 5, end: 7, action: 'focus', manual: true, x: 100, y: 300, width: 1000, height: 20 }];
  const { shots } = plan({ focuses, clicks: [{ t: 1.1 }] });
  assert.equal(shots.length, 2);
  assert.equal(shots[1].startAt, shots[0].releaseAt);
  assert.ok(shots[0].releaseAt <= 3.3 + 1e-9);
  const elsewhere = plan({ focuses: [focuses[0], { ...focuses[1], y: 700 }], clicks: [{ t: 1.1 }] });
  assert.ok(elsewhere.shots[1].startAt - elsewhere.shots[0].releaseAt > 1, 'an unrelated focus keeps the overview reveal');
});

const still = (t, x = 500, y = 400) => ({ t, x, y });

test('the pointer hides while typing and after a while idle, and is back 250 ms before it moves', () => {
  const timeline = { focuses: [{ action: 'type', t: 1, typingStart: 1.4 }], clicks: [{ t: 1.2, up: 1.3 }], keys: [],
    points: [still(0), still(1), still(5), still(5.5, 700)] };
  assert.deepEqual(hiddenSpans(timeline), [{ start: 1.4, end: 4.75 }, { start: 9, end: Infinity }]);
  const spans = hiddenSpans(timeline);
  assert.equal(visibilityAt(spans, 1.3), 1);
  assert.equal(visibilityAt(spans, 2), 0);
  assert.equal(visibilityAt(spans, 5), 1);
  assert.ok(visibilityAt(spans, 4.85) > 0 && visibilityAt(spans, 4.85) < 1);
  assert.deepEqual(keyboardTimes({ keys: [{ t: 5 }], focuses: [{ action: 'type', t: 1, typingStart: 1.4 }, { action: 'click', t: 3 }] }), [1.4],
    'a single Escape or Enter keeps the pointer in view');
  const idle = hiddenSpans({ focuses: [], clicks: [], points: [still(0), still(1), still(1.5, 900), still(20, 900)] });
  assert.deepEqual(idle, [{ start: 5, end: Infinity }]);
  const scrolling = hiddenSpans({ focuses: [], clicks: [], scrolls: [{ start: 4, end: 7 }], points: [still(0), still(1), still(1.5, 900), still(20, 900)] });
  assert.deepEqual(scrolling, [{ start: 10.5, end: Infinity }], 'the pointer stays in view while it scrolls the page');
});

test('fading never blinks: hides shorter than half a second are skipped and opacity changes gradually', () => {
  const points = [still(0), still(1), still(1.5, 900), still(5.2, 900), still(5.6, 400)];
  assert.deepEqual(hiddenSpans({ focuses: [], clicks: [], points }), [{ start: 9.1, end: Infinity }],
    'no hide at 5 s: idle 3.5 s but moving again 0.2 s later');
  const spans = [{ start: 1, end: 3 }];
  for (let t = 0; t < 4; t += 1 / 60) assert.ok(Math.abs(visibilityAt(spans, t + 1 / 60) - visibilityAt(spans, t)) < 0.15);
});

function dragCamera(moveAt, travel) {
  // Resting pointer at the view center while the camera pans `travel` page pixels from `moveAt`.
  return Array.from({ length: 360 }, (_, i) => {
    const t = i / 60;
    const k = Math.min(1, Math.max(0, (t - moveAt) / 0.6));
    return { t, x: 500 + travel * k * k * (3 - 2 * k), y: 400, zoom: 1 };
  });
}

test('a camera move that would drag the resting pointer across the frame hides it first', () => {
  const timeline = { focuses: [], clicks: [], points: [still(0), still(0.5), still(1, 520), still(5, 520), still(5.5, 600)] };
  const view = { ratio: 1, width: 1920, height: 1080 };
  const drags = cameraDrags(timeline, { ...view, camera: dragCamera(2, 600) });
  assert.equal(drags.length, 1);
  assert.ok(Math.abs(drags[0].start - 2) < 0.05 && Math.abs(drags[0].end - 2.6) < 0.05);
  const spans = hiddenSpans(timeline, drags);
  assert.ok(visibilityAt(spans, 2.1) < 0.1, 'mostly gone before the pan gathers speed');
  assert.equal(visibilityAt(spans, 5), 1, 'back 250 ms before the hand moves');
  assert.deepEqual(cameraDrags(timeline, { ...view, camera: dragCamera(2, 60) }), [], 'a small reframe keeps it visible');
  const opening = hiddenSpans({ focuses: [], clicks: [], points: [still(0), still(4), still(4.5, 900)] }, [{ start: 1.5, end: 2.1 }]);
  assert.equal(visibilityAt(opening, 0), 0, 'a pointer that would vanish before it ever moves is not shown at all');
  assert.equal(visibilityAt(opening, 3.96), 1);
  const clicked = { focuses: [], points: [still(0), still(1), still(1.5, 900), still(9, 900)], clicks: [{ t: 2, up: 2.1 }] };
  assert.deepEqual(hiddenSpans(clicked, [{ start: 1.85, end: 2.3 }]), [{ start: 5.9, end: Infinity }],
    'a drag already over when the click lets the pointer go does not hide it early');
});

test('the camera settling after a gesture keeps the pointer visible', () => {
  const points = [still(0), still(1), still(2, 900), still(6, 900), still(6.5, 400)];
  // Camera lags the hand and keeps easing for a while after the hand stops at 2 s.
  const camera = Array.from({ length: 480 }, (_, i) => {
    const t = i / 60;
    return { t, x: 500 + 700 * (1 - Math.exp(-Math.max(0, t - 1) * 2)), y: 400, zoom: 1 };
  });
  assert.deepEqual(cameraDrags({ focuses: [], clicks: [], points }, { camera, ratio: 1, width: 1920, height: 1080 }), []);
});

test('a scripted focus far from the resting pointer hides it, and the video ends on a still overview', () => {
  const timeline = {
    viewport: { width: 1440, height: 810 }, duration: 6, scrolls: [], keys: [],
    points: [still(0, 1300, 700), still(0.5, 1300, 700), still(1, 1250, 650), still(6, 1250, 650)],
    clicks: [{ t: 1.2, up: 1.3, x: 1250, y: 650 }],
    focuses: [click(1.2, { x: 1200, y: 630, width: 100, height: 40 }),
      { t: 3, readyAt: 3, end: 5, action: 'focus', manual: true, x: 100, y: 100, width: 300, height: 40 }],
  };
  const { frames, duration } = renderTracks(timeline, {
    scene: { width: 1756, height: 988 }, level: 1.8, fps: 60, top: -40, ratio: 1920 / 1756, width: 1920, height: 1080,
  });
  const at = t => frames[Math.round(t * 60)];
  assert.equal(frames.length, Math.ceil(duration * 60));
  assert.equal(at(1.2).cursor.opacity, 1);
  assert.ok(at(3.3).cursor.opacity < 0.01);
  const closing = frames.slice(-18).map(frame => frame.camera);
  assert.ok(Math.abs(closing[0].zoom - 1) < 2e-3);
  assert.ok(Math.hypot(closing.at(-1).x - closing[0].x, closing.at(-1).y - closing[0].y) < 1, 'the video ends at rest');
});

test('the drawn pointer glides through a spring like Screen Studio, yet sits exactly on every click', async () => {
  const { CursorTrack } = await import('../src/render/cursor.mjs');
  const { pointerPath } = await import('../src/motion.mjs');
  const path = pointerPath({ x: 100, y: 500 }, { x: 900, y: 300 }, 0.7, { seed: 2 }).map(point => ({ ...point, t: point.t + 1 }));
  const points = [{ t: 0, x: 100, y: 500 }, ...path, { t: 4, x: 900, y: 300 }];
  const timeline = { points, clicks: [{ t: 2, up: 2.1, x: 900, y: 300 }], focuses: [], cursors: [] };
  const track = new CursorTrack(timeline, 60);
  const frames = Array.from({ length: 240 }, (_, i) => ({ t: i / 60, ...track.update(i / 60).point }));
  const at = t => frames[Math.round(t * 60)];
  assert.ok(Math.hypot(at(2).x - 900, at(2).y - 300) < 0.01, 'pinned on the click');
  assert.ok(Math.hypot(at(3.5).x - 900, at(3.5).y - 300) < 0.5, 'settles on target');
  const accel = list => Math.max(...list.slice(2).map((p, i) => Math.hypot(
    p.x - 2 * list[i + 1].x + list[i].x, p.y - 2 * list[i + 1].y + list[i].y)));
  const raw = Array.from({ length: 240 }, (_, i) => {
    const t = i / 60;
    const k = points.findIndex(point => point.t > t);
    const [a, b] = [points[Math.max(0, k - 1)], points[k] ?? points.at(-1)];
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  });
  assert.ok(accel(frames.slice(55, 120)) < accel(raw.slice(55, 120)), 'smoother than tracing the hand');
});
