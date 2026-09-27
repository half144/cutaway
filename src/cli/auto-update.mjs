import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const interval = 24 * 60 * 60 * 1000;

// Installs made by install.sh carry a marker inside .git and update themselves at most once a day, before
// the CLI loads: a recording never runs half on old code and half on new. Development clones have no
// marker and are never touched. Offline, or with local edits, the installed version simply stays.
export function autoUpdate(repository, { now = Date.now(), log = message => process.stderr.write(message) } = {}) {
  const marker = join(repository, '.git', 'cutaway-auto-update');
  if (process.env.CUTAWAY_NO_UPDATE || !existsSync(marker)) return;
  if (now - Number(readFileSync(marker, 'utf8')) < interval) return;
  writeFileSync(marker, String(now));

  const run = (command, args, timeout) => execFileSync(command, args, {
    cwd: repository, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const git = (...args) => run('git', args, 15000);
  try {
    git('fetch', '--quiet');
    const head = git('rev-parse', 'HEAD');
    const latest = git('rev-parse', '@{u}');
    if (head === latest || git('status', '--porcelain', '--untracked-files=no')) return;
    const dependenciesChanged = git('diff', '--name-only', head, latest, '--', 'package-lock.json') !== '';
    git('merge', '--ff-only', '--quiet', latest);
    if (dependenciesChanged) {
      run('npm', ['ci', '--silent', '--no-audit', '--no-fund'], 300000);
      run('npx', ['--yes', 'playwright', 'install', 'chromium'], 600000);
    }
    log(`Cutaway updated: ${head.slice(0, 7)} → ${latest.slice(0, 7)}\n`);
  } catch {
    // Offline, a rewritten history or a failed install: keep going with what is installed.
  }
}
