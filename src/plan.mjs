import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const actions = new Set(['click', 'type', 'scroll', 'wait', 'focus', 'press']);

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('The plan must be a JSON object.');
  if (typeof plan.url !== 'string' || !/^(https?:|file:)/.test(plan.url)) {
    throw new Error('url must start with http:, https: or file:.');
  }
  if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error('steps must be a non-empty array.');
  // 16:9 matches the default export, so the window sits with even margins instead of pillarboxed.
  const viewport = plan.viewport ?? { width: 1440, height: 810 };
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(viewport[key]) || viewport[key] < 320 || viewport[key] > 3840) {
      throw new Error(`viewport.${key} must be an integer from 320 to 3840.`);
    }
  }
  const captureScale = plan.captureScale ?? 2;
  if (!Number.isFinite(captureScale) || captureScale < 1 || captureScale > 3
    || Math.max(viewport.width, viewport.height) * captureScale > 8192) {
    throw new Error('captureScale must be between 1 and 3, with source dimensions at most 8192 pixels.');
  }
  if (plan.timeout !== undefined && (!Number.isInteger(plan.timeout) || plan.timeout < 1 || plan.timeout > 120000)) {
    throw new Error('timeout must be an integer from 1 to 120000 milliseconds.');
  }
  for (const [index, step] of plan.steps.entries()) {
    const fail = message => { throw new Error(`Step ${index + 1}: ${message}`); };
    if (!step || !actions.has(step.action)) fail('unsupported action.');
    if (['click', 'type', 'focus'].includes(step.action) && !step.selector) fail('selector is required.');
    if (step.selector !== undefined && typeof step.selector !== 'string') fail('selector must be a string.');
    if (step.expect !== undefined && (typeof step.expect !== 'string' || !step.expect)) fail('expect must be a non-empty selector.');
    if (step.action === 'type' && typeof step.text !== 'string') fail('text must be a string.');
    if (step.action === 'press' && typeof step.key !== 'string') fail('key must be a string.');
    if (step.action === 'scroll' && !Number.isFinite(step.y)) fail('y must be a finite number of pixels.');
    for (const key of ['duration', 'pause']) {
      if (step[key] !== undefined && (!Number.isFinite(step[key]) || step[key] < 0 || step[key] > 60)) {
        fail(`${key} must be between 0 and 60 seconds.`);
      }
    }
  }
  return { ...plan, viewport, captureScale };
}

export async function loadPlan(planPath) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (typeof plan?.url === 'string' && plan.url.startsWith('file:./')) {
    plan.url = pathToFileURL(resolve(dirname(planPath), plan.url.slice(5))).href;
  }
  return validatePlan(plan);
}
