import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { devices } from 'playwright';

const actions = new Set(['click', 'type', 'scroll', 'wait', 'focus', 'press']);
// On a phone the same gestures read as a tap and a swipe.
const aliases = { tap: 'click', swipe: 'scroll' };
// Space the phone's system UI takes above and below the page, in CSS pixels: the status bar and the
// home indicator (or gesture bar). The page is laid out between them, like a web app added to the home screen.
const systemBars = { iphone: { top: 54, bottom: 34 }, android: { top: 36, bottom: 24 } };

// A phone from Playwright's device list, emulated in Chromium: its screen, touch input and user agent.
export function mobileDevice(name) {
  const descriptor = devices[name];
  if (typeof name !== 'string' || !descriptor?.isMobile || !descriptor.hasTouch) {
    throw new Error('device must be a phone from Playwright\'s device list, such as "iPhone 15 Pro" or "Pixel 7".');
  }
  const { width, height } = descriptor.screen ?? descriptor.viewport;
  if (descriptor.viewport.width > descriptor.viewport.height) throw new Error(`device "${name}" is in landscape; only portrait phones are supported.`);
  if (width >= 600) throw new Error(`device "${name}" is a tablet; only phones are supported.`);
  const kind = name.startsWith('iPhone') ? 'iphone' : 'android';
  // The frame is a modern, home-button-free iPhone.
  if (kind === 'iphone' && height < 812) throw new Error(`device "${name}" has a home button; use an iPhone X or newer.`);
  return { name, kind, screen: { width, height }, insets: systemBars[kind] };
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('The plan must be a JSON object.');
  if (typeof plan.url !== 'string' || !/^(https?:|file:)/.test(plan.url)) {
    throw new Error('url must start with http:, https: or file:.');
  }
  if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error('steps must be a non-empty array.');
  const device = plan.device === undefined ? undefined : mobileDevice(plan.device);
  if (device && plan.viewport) throw new Error('A device sets its own viewport; remove viewport or device.');
  // 16:9 matches the default export, so the window sits with even margins instead of pillarboxed.
  const viewport = device
    ? { width: device.screen.width, height: device.screen.height - device.insets.top - device.insets.bottom }
    : plan.viewport ?? { width: 1440, height: 810 };
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(viewport[key]) || viewport[key] < 320 || viewport[key] > 3840) {
      throw new Error(`viewport.${key} must be an integer from 320 to 3840.`);
    }
  }
  // Phones render at 3× like the hardware; an integer scale keeps screencast frames an exact size.
  const captureScale = plan.captureScale ?? (device ? 3 : 2);
  if (!Number.isFinite(captureScale) || captureScale < 1 || captureScale > 3
    || Math.max(viewport.width, viewport.height) * captureScale > 8192) {
    throw new Error('captureScale must be between 1 and 3, with source dimensions at most 8192 pixels.');
  }
  if (plan.timeout !== undefined && (!Number.isInteger(plan.timeout) || plan.timeout < 1 || plan.timeout > 120000)) {
    throw new Error('timeout must be an integer from 1 to 120000 milliseconds.');
  }
  const steps = plan.steps.map(step => aliases[step?.action] ? { ...step, action: aliases[step.action] } : step);
  for (const [index, step] of steps.entries()) {
    const fail = message => { throw new Error(`Step ${index + 1}: ${message}`); };
    if (!step || !actions.has(step.action)) fail('unsupported action.');
    if (['click', 'type', 'focus'].includes(step.action) && !step.selector) fail('selector is required.');
    if (step.selector !== undefined && typeof step.selector !== 'string') fail('selector must be a string.');
    if (step.expect !== undefined && (typeof step.expect !== 'string' || !step.expect)) fail('expect must be a non-empty selector.');
    if (step.action === 'type' && typeof step.text !== 'string') fail('text must be a string.');
    if (step.action === 'press' && typeof step.key !== 'string') fail('key must be a string.');
    if (step.action === 'scroll' && !Number.isFinite(step.y)) fail('y must be a finite number of pixels.');
    if (step.hold !== undefined && (step.action !== 'click' || !Number.isFinite(step.hold) || step.hold < 0.05 || step.hold > 5)) {
      fail('hold must be 0.05 to 5 seconds, on a click or tap.');
    }
    for (const key of ['duration', 'pause']) {
      if (step[key] !== undefined && (!Number.isFinite(step[key]) || step[key] < 0 || step[key] > 60)) {
        fail(`${key} must be between 0 and 60 seconds.`);
      }
    }
  }
  return { ...plan, viewport, captureScale, device, steps };
}

export async function loadPlan(planPath) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (typeof plan?.url === 'string' && plan.url.startsWith('file:./')) {
    plan.url = pathToFileURL(resolve(dirname(planPath), plan.url.slice(5))).href;
  }
  return validatePlan(plan);
}
