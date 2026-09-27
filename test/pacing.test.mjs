import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import assert from 'node:assert/strict';
import { clickHold, clickSettleDelay, pauseAfter, typingDelays } from '../src/capture/pacing.mjs';
import { paceTimeline } from '../src/render/pacing.mjs';
import { stillFrames } from '../src/render/stillness.mjs';

test('capture pacing keeps a lively, uneven beat and gives results a moment to register', () => {
  const between = (value, low, high) => value >= low - 1e-9 && value <= high + 1e-9;
  const clicks = [0, 1, 2, 3, 4, 5].map(index => pauseAfter({ action: 'click' }, { action: 'click' }, 0, index));
  assert.ok(clicks.every(pause => between(pause, 0.245, 0.455)));
  assert.ok(new Set(clicks.map(pause => pause.toFixed(3))).size > 3, 'no metronome');
  assert.ok(between(pauseAfter({ action: 'click' }, { action: 'type' }, 0, 2), 0.196, 0.364));
  assert.equal(pauseAfter({ action: 'click', expect: '#done' }), 0.8);
  assert.ok(Math.abs(pauseAfter({ action: 'click', expect: '#done' }, null, 3) - 1.05) < 1e-9);
  assert.equal(pauseAfter({ action: 'click', expect: '#done' }, null, 40), 1.6);
  assert.equal(pauseAfter({ action: 'click', pause: 1.2 }), 1.2);
});

test('mouse buttons are held like a person holds them', () => {
  const holds = [0, 1, 2, 3, 4].map(clickHold);
  assert.ok(holds.every(hold => hold >= 0.095 && hold <= 0.125));
  assert.ok(new Set(holds).size > 1);
});

test('typing reads as a skilled person: ~100 WPM, slower word starts, pauses after punctuation', () => {
  const text = 'Simplificar a navegação e preparar uma experiência clara para novos clientes. Revisar amanhã, com calma.';
  const delays = typingDelays(text, 3);
  assert.deepEqual(delays, typingDelays(text, 3));
  const mean = delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
  assert.ok(mean > 100 && mean < 160, `mean ${mean} ms`);
  const characters = [...text];
  const average = select => {
    const chosen = delays.filter((_, index) => select(characters[index - 1], characters[index]));
    return chosen.reduce((sum, delay) => sum + delay, 0) / chosen.length;
  };
  assert.ok(average(previous => previous === ' ') > average(previous => /[a-z]/.test(previous ?? '')) * 1.15);
  assert.ok(average(previous => previous === '.') > 400);
});

test('the pause before a click varies like a person verifying the aim, longer for small targets and commits', () => {
  const delays = Array.from({ length: 30 }, (_, index) => clickSettleDelay(index));
  assert.ok(delays.every(delay => delay >= 0.07 && delay <= 0.45));
  const mean = delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
  const spread = Math.sqrt(delays.reduce((sum, delay) => sum + (delay - mean) ** 2, 0) / delays.length) / mean;
  assert.ok(spread > 0.2, 'no metronome');
  assert.ok(clickSettleDelay(4, 5) > clickSettleDelay(4, 2), 'a hard target takes longer to verify');
  assert.ok(Math.abs(clickSettleDelay(4, 2, true) - clickSettleDelay(4, 2) - 0.15) < 1e-9, 'a beat before committing');
});

test('balanced pacing compresses only long idle spans and keeps events ordered', () => {
  const source = {
    duration: 12,
    frames: [{ t: 0 }, { t: 2 }, { t: 6 }, { t: 10 }],
    points: [{ t: 1 }, { t: 7 }],
    clicks: [{ t: 1.5 }, { t: 7.5 }],
    focuses: [{ t: 1, interactionEnd: 2, end: 6 }],
    steps: [{ action: 'click', start: 1, interactionEnd: 2, expectationEnd: 6, end: 6.5 }],
  };
  const paced = paceTimeline(source);

  assert.ok(paced.report.gaps.some(gap => gap.kind === 'expect'));
  assert.ok(paced.timeline.duration < source.duration);
  const [focus] = paced.timeline.focuses;
  assert.ok(Math.abs(focus.interactionEnd - focus.t - 1) < 1e-9, 'the action itself keeps its duration');
  assert.ok(focus.end - focus.interactionEnd > 2.4, 'a long wait is shortened, not removed');
  assert.ok(paced.timeline.clicks[1].t > paced.timeline.clicks[0].t);
  assert.equal(source.duration, 12);
});

test('balanced pacing moves every recorded moment, including clicks released, keys, carets and results', () => {
  const source = {
    duration: 12,
    steps: [{ action: 'wait', start: 1, interactionEnd: 7, end: 7 }],
    clicks: [{ t: 9, up: 9.1 }],
    keys: [{ t: 10 }],
    focuses: [{ t: 8.5, approachStart: 8.2, typingStart: 9.5, carets: [{ t: 10.5 }], result: { t: 11 }, end: 11 }],
  };
  const paced = paceTimeline(source).timeline;
  const shift = source.duration - paced.duration;
  assert.ok(shift > 0);
  const [focus] = paced.focuses;
  for (const [after, before] of [[paced.clicks[0].up, 9.1], [paced.keys[0].t, 10], [focus.approachStart, 8.2], [focus.typingStart, 9.5],
    [focus.carets[0].t, 10.5], [focus.result.t, 11]]) {
    assert.ok(Math.abs(before - after - shift) < 1e-9);
  }
});

test('dead time is trimmed invisibly: a beat of stillness is kept on each side, gestures and readings are untouched', () => {
  const source = {
    duration: 9,
    frames: [{ t: 0 }, { t: 1 }, { t: 6 }, { t: 6.5 }],
    points: [{ t: 0, x: 10, y: 10 }, { t: 1, x: 10, y: 10 }, { t: 1.4, x: 300, y: 200 }, { t: 9, x: 300, y: 200 }],
    clicks: [{ t: 1.5, up: 1.6 }],
    focuses: [{ t: 7, readyAt: 6.6, end: 9, action: 'focus', manual: true }],
    steps: [],
  };
  const paced = paceTimeline(source);
  const trimmed = paced.report.gaps.filter(gap => gap.kind === 'static');
  assert.equal(trimmed.length, 1, 'only the still stretch between the click and the next repaint');
  assert.ok(Math.abs(trimmed[0].sourceSeconds - (6 - 1.95)) < 1e-3);
  assert.ok(Math.abs(trimmed[0].outputSeconds - (0.7 + (4.05 - 0.7) / 3.5)) < 1e-3);
  assert.equal(paced.timeline.points[2].t, 1.4, 'the gesture keeps its timing');
  assert.equal(paced.timeline.clicks[0].t, 1.5);
  const focus = paced.timeline.focuses[0];
  assert.ok(focus.end - focus.readyAt >= 1.8 - 1e-9, 'an explicit focus keeps its reading time');
});

test('imperceptible repaints (a blinking caret, a small spinner) do not interrupt dead time', () => {
  const source = {
    duration: 6,
    frames: [0, 1, 1.5, 2, 2.5, 3, 5.5].map(t => ({ t })),
    points: [{ t: 0, x: 10, y: 10 }, { t: 6, x: 10, y: 10 }],
    clicks: [], focuses: [], steps: [],
  };
  assert.equal(paceTimeline(source).report.gaps.filter(gap => gap.kind === 'static').length, 1, 'only 3–5.5 s is long enough');
  const still = new Set([2, 3, 4, 5]);
  const [gap] = paceTimeline(source, 'balanced', still).report.gaps;
  assert.ok(gap.sourceSeconds > 4, 'the caret blinks no longer split the stretch');
});

test('original pacing preserves the source timeline object', () => {
  const source = { duration: 8, frames: [] };
  const paced = paceTimeline(source, 'original');
  assert.equal(paced.timeline, source);
  assert.equal(paced.report.savedSeconds, 0);
});

test('a caret blink counts as still; a toast appearing does not', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-screen-still-'));
  try {
    const draw = async (name, paint) => {
      const canvas = createCanvas(1440, 810);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 1440, 810);
      paint(context);
      await writeFile(join(directory, name), await canvas.encode('png'));
      return { file: name };
    };
    const frames = [
      await draw('0.png', () => {}),
      await draw('1.png', context => { context.fillStyle = '#000'; context.fillRect(700, 400, 2, 18); }),
      await draw('2.png', context => { context.fillStyle = '#233'; context.fillRect(540, 24, 360, 54); }),
    ].map((frame, index) => ({ ...frame, t: 1.5 + index }));
    const timeline = { duration: 6, frames: [{ t: 0, file: '0.png' }, ...frames], points: [], clicks: [], focuses: [], steps: [] };
    const still = await stillFrames(timeline, directory);
    assert.equal(still.has(2), true, 'caret blink');
    assert.equal(still.has(3), false, 'toast');
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('slow-motion capture plays back at real speed, linearly, in every pacing mode', () => {
  const source = {
    duration: 8,
    frames: [0, 1, 2, 3, 4, 5, 6].map(t => ({ t })),
    scrolls: [{ start: 1, end: 5.2, automatic: true }],
    slowMotion: [{ start: 1, end: 5, factor: 4 }],
  };
  for (const mode of ['balanced', 'original']) {
    const { timeline, report } = paceTimeline(source, mode);
    assert.deepEqual(timeline.frames.slice(1).map(frame => frame.t), [1, 1.25, 1.5, 1.75, 2, 3]);
    assert.equal(report.slowMotionSeconds, 3);
  }
});
