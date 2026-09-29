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

test('a key pressed into a field attaches its expected result to that field', async () => {
  const box = { x: 900, y: 20, width: 300, height: 50 };
  const result = { waitFor: async () => {}, evaluate: async () => ({ box, words: 3 }) };
  const page = { locator: () => ({ first: () => result }), keyboard: { press: async () => {} } };
  const field = { action: 'type', t: 1, x: 100, y: 300, width: 200, height: 40 };
  const timeline = { focuses: [field], keys: [] };
  const runner = new ActionRunner(page, timeline, () => 4, { x: 0, y: 0 });
  runner.previousFocus = field;
  await runner.run({ action: 'press', key: 'Enter', expect: '#toast', pause: 0 }, 1);
  assert.deepEqual(field.result, { t: 4, ...box });
  assert.deepEqual(timeline.keys, [{ t: 4, key: 'Enter' }]);
});

test('manual focus accepts visible non-clickable elements and holds through expectations', async () => {
  let time = 1;
  const box = { x: 50, y: 50, width: 100, height: 40 };
  const locator = {
    waitFor: async () => {}, count: async () => 1,
    evaluate: async () => null, boundingBox: async () => box,
    click: async () => { throw new Error('Disabled element cannot be clicked'); },
  };
  const result = { waitFor: async () => { time = 8; }, evaluate: async () => ({ box, words: 2 }) };
  const page = { locator: selector => selector === '#result' ? { first: () => result } : locator };
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

test('an upload is a click whose file chooser receives the plan files', async () => {
  const base = { url: 'https://example.com' };
  const [upload] = validatePlan({ ...base, steps: [{ action: 'upload', selector: '#cover', file: 'cover.jpg' }] }).steps;
  assert.deepEqual(upload, { action: 'click', selector: '#cover', file: ['cover.jpg'] });
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'upload', selector: '#cover' }] }), /file must be/);
  assert.throws(() => validatePlan({ ...base, steps: [{ action: 'click', selector: '#cover', file: 'a.jpg' }] }), /upload step/);

  let received;
  const box = { x: 50, y: 50, width: 100, height: 40 };
  const locator = { waitFor: async () => {}, count: async () => 1, evaluate: async () => null, boundingBox: async () => box, click: async () => {} };
  const page = {
    locator: () => locator,
    mouse: { move: async () => {}, down: async () => {}, up: async () => {} },
    waitForEvent: async event => event === 'filechooser' && { setFiles: async files => { received = files; } },
    evaluate: async () => null,
  };
  const runner = new ActionRunner(page, { points: [], clicks: [], focuses: [] }, () => 0, { x: 100, y: 70 });
  await runner.run({ ...upload, pause: 0 }, 0);
  assert.deepEqual(received, ['cover.jpg']);
});

test('colorScheme is light or dark', () => {
  const plan = { url: 'https://example.com', steps: [{ action: 'wait' }] };
  assert.equal(validatePlan({ ...plan, colorScheme: 'dark' }).colorScheme, 'dark');
  for (const colorScheme of ['night', true, '']) assert.throws(() => validatePlan({ ...plan, colorScheme }), /colorScheme/);
});

test('hide takes a non-empty list of selectors', () => {
  const plan = { url: 'https://example.com', steps: [{ action: 'wait' }] };
  assert.deepEqual(validatePlan({ ...plan, hide: ['nextjs-portal'] }).hide, ['nextjs-portal']);
  for (const hide of [[], 'nextjs-portal', [''], [1]]) assert.throws(() => validatePlan({ ...plan, hide }), /hide/);
});
