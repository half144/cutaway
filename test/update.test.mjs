import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoUpdate } from '../src/cli/auto-update.mjs';

const day = 24 * 60 * 60 * 1000;
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

// An upstream repository, an install cloned from it with the marker, and a new upstream commit.
function setup({ marker = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cutaway-update-'));
  const upstream = join(root, 'upstream');
  git(root, 'init', '--quiet', '-b', 'master', upstream);
  writeFileSync(join(upstream, 'cli.mjs'), 'old');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '--quiet', '-m', 'old');
  const install = join(root, 'install');
  git(root, 'clone', '--quiet', upstream, install);
  if (marker) writeFileSync(join(install, '.git', 'cutaway-auto-update'), '0');
  writeFileSync(join(upstream, 'cli.mjs'), 'new');
  git(upstream, 'commit', '--quiet', '-am', 'new');
  return { install, latest: git(upstream, 'rev-parse', 'HEAD') };
}

test('a managed install fast-forwards to upstream and reports it', () => {
  const { install, latest } = setup();
  const messages = [];
  autoUpdate(install, { now: day, log: message => messages.push(message) });
  assert.equal(git(install, 'rev-parse', 'HEAD'), latest);
  assert.equal(readFileSync(join(install, 'cli.mjs'), 'utf8'), 'new');
  assert.match(messages[0], /Cutaway updated: \w{7} → \w{7}/);
});

test('updates are checked at most once a day', () => {
  const { install, latest } = setup();
  writeFileSync(join(install, '.git', 'cutaway-auto-update'), String(day));
  autoUpdate(install, { now: day + day / 2, log: () => {} });
  assert.notEqual(git(install, 'rev-parse', 'HEAD'), latest);
  autoUpdate(install, { now: 2 * day + 1, log: () => {} });
  assert.equal(git(install, 'rev-parse', 'HEAD'), latest);
});

test('development clones, local edits and the opt-out are left alone', () => {
  const clone = setup({ marker: false });
  autoUpdate(clone.install, { now: day, log: () => {} });
  assert.notEqual(git(clone.install, 'rev-parse', 'HEAD'), clone.latest);

  const edited = setup();
  writeFileSync(join(edited.install, 'cli.mjs'), 'edited');
  autoUpdate(edited.install, { now: day, log: () => {} });
  assert.equal(readFileSync(join(edited.install, 'cli.mjs'), 'utf8'), 'edited');

  const optedOut = setup();
  process.env.CUTAWAY_NO_UPDATE = '1';
  try {
    autoUpdate(optedOut.install, { now: day, log: () => {} });
  } finally {
    delete process.env.CUTAWAY_NO_UPDATE;
  }
  assert.notEqual(git(optedOut.install, 'rev-parse', 'HEAD'), optedOut.latest);
});

test('an unreachable upstream keeps the installed version', () => {
  const { install } = setup();
  git(install, 'remote', 'set-url', 'origin', '/nonexistent/cutaway');
  const head = git(install, 'rev-parse', 'HEAD');
  autoUpdate(install, { now: day, log: () => {} });
  assert.equal(git(install, 'rev-parse', 'HEAD'), head);
});
