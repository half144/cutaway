import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRunner } from '../src/capture/actions.mjs';
import { ScreencastRecorder } from '../src/capture/screencast.mjs';
import { validatePlan } from '../src/plan.mjs';
import { EventEmitter } from 'node:events';

test('stationary targets do not replay a pointer animation', async () => {
  const timeline = { points: [] };
  const runner = new ActionRunner({}, timeline, () => 0, { x: 50, y: 50 });
  await runner.moveTo({ x: 51, y: 50 });
  assert.deepEqual(timeline.points, []);
});

test('manual focus accepts visible non-clickable elements and holds through expectations', async () => {
  let time = 1;
  const box = { x: 50, y: 50, width: 100, height: 40 };
  const locator = {
    waitFor: async () => {}, count: async () => 1,
    evaluate: async () => null, boundingBox: async () => box,
    click: async () => { throw new Error('Disabled element cannot be clicked'); },
  };
  const page = { locator: selector => selector === '#result'
    ? { waitFor: async () => { time = 8; } } : locator };
  const timeline = { focuses: [] };
  const runner = new ActionRunner(page, timeline, () => time, { x: 0, y: 0 });
  await runner.run({ action: 'focus', selector: '#disabled', expect: '#result', duration: 0, pause: 0 }, 0);
  assert.equal(timeline.focuses[0].end, 8);
});

test('stop drains pending frame writes even when CDP stop fails', async () => {
  let drained = false;
  const recorder = new ScreencastRecorder({ send: async () => { throw new Error('Disconnected'); } });
  recorder.started = true;
  recorder.pending = new Promise(resolve => setTimeout(() => { drained = true; resolve(); }, 10));
  await assert.rejects(recorder.stop(), /Disconnected/);
  assert.equal(drained, true);
  assert.equal(recorder.started, false);
});

test('invalid timeouts cannot disable action time limits', () => {
  for (const timeout of [0, -1, Infinity, '1000']) {
    assert.throws(() => validatePlan({ url: 'https://example.com', steps: [{ action: 'wait' }], timeout }), /timeout/);
  }
});

test('capture rejects silently downscaled compositor frames', async () => {
  const session = new EventEmitter();
  const recorder = new ScreencastRecorder(session, '/unused', { frames: [] }, { width: 2880, height: 1800 }, Date.now());
  recorder.registerFrameHandler();
  const header = Buffer.alloc(24);
  header.writeUInt32BE(1440, 16);
  header.writeUInt32BE(900, 20);
  session.emit('Page.screencastFrame', { metadata: {}, data: header.toString('base64'), sessionId: 1 });
  await recorder.pending;
  assert.throws(() => recorder.assertHealthy(), /expected 2880×1800, received 1440×900/);
});
