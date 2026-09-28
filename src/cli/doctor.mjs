import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ffmpeg } from '../ffmpeg.mjs';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));

export async function doctor({ capture = true, render = true } = {}) {
  const checks = [];
  async function check(name, inspect, fix) {
    try {
      await inspect();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, error: error.message, fix });
    }
  }
  await check('node', () => {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ required');
  }, 'Install Node.js 22 or newer.');
  if (capture) {
    await check('chromium', async () => {
      const { chromium } = await import('playwright');
      await access(chromium.executablePath());
    }, `In ${repository}: npm ci (only if Playwright is missing), then npx playwright install chromium.`);
  }
  if (render) {
    await check('canvas', async () => {
      const { createCanvas } = await import('@napi-rs/canvas');
      createCanvas(2, 2).getContext('2d');
    }, `Run npm ci in ${repository}.`);
    await check('ffmpeg', async () => {
      const { stdout } = await run(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 5000 });
      if (!/\blibx264\b/.test(stdout)) throw new Error('FFmpeg lacks libx264');
    }, `Run npm ci in ${repository} to download FFmpeg, or put an FFmpeg with libx264 on PATH.`);
  }
  return { ready: checks.every(check => check.ok), repository, checks };
}
