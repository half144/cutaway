import test from 'node:test';
import assert from 'node:assert/strict';
import { clickSettleDelay, pauseAfter } from '../src/capture/pacing.mjs';
import { paceTimeline } from '../src/render/pacing.mjs';

test('capture pacing gives click sequences room without slowing deliberate holds', () => {
  assert.equal(pauseAfter({ action: 'click' }, { action: 'click' }), 0.36);
  assert.equal(pauseAfter({ action: 'click' }, { action: 'type' }), 0.32);
  assert.equal(pauseAfter({ action: 'click', expect: '#done' }), 0.55);
  assert.equal(pauseAfter({ action: 'focus' }), 0.2);
  assert.equal(pauseAfter({ action: 'click', pause: 1.2 }), 1.2);
});

test('click settling pauses briefly and varies without becoming sluggish', () => {
  const delays = [0, 1, 2, 3].map(clickSettleDelay);
  assert.ok(delays.every(delay => delay >= 0.12 && delay <= 0.18));
  assert.ok(new Set(delays).size > 1);
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

  assert.equal(paced.report.adjustedGaps, 1);
  assert.ok(paced.timeline.duration < source.duration);
  assert.equal(paced.timeline.focuses[0].interactionEnd, 2);
  assert.ok(paced.timeline.focuses[0].end > 4.4);
  assert.ok(paced.timeline.clicks[1].t > paced.timeline.clicks[0].t);
  assert.equal(source.duration, 12);
});

test('original pacing preserves the source timeline object', () => {
  const source = { duration: 8, frames: [] };
  const paced = paceTimeline(source, 'original');
  assert.equal(paced.timeline, source);
  assert.equal(paced.report.savedSeconds, 0);
});
