import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from '../src/cli/options.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../skills/cutaway/scripts/run.mjs', import.meta.url));
const plan = fileURLToPath(new URL('../examples/demo.json', import.meta.url));

test('doctor takes no positional input; validate requires a plan', () => {
  assert.equal(parseCliArgs(['doctor']).command, 'doctor');
  assert.throws(() => parseCliArgs(['doctor', 'extra']));
  assert.throws(() => parseCliArgs(['validate']));
  assert.equal(parseCliArgs(['snap', 'plan.json', '--out', 'shots']).command, 'snap');
});

test('skill runner validates from a different project without FFmpeg', async () => {
  const { stdout } = await run(process.execPath, [cli, 'validate', plan], {
    cwd: '/tmp', env: { ...process.env, PATH: '' },
  });
  assert.equal(JSON.parse(stdout).steps, 4);
});

test('doctor finds the bundled FFmpeg without one on PATH', async () => {
  const { stdout } = await run(process.execPath, [cli, 'doctor'], {
    env: { ...process.env, PATH: '' },
  });
  const report = JSON.parse(stdout);
  assert.equal(report.checks.find(check => check.name === 'ffmpeg').ok, true);
});
