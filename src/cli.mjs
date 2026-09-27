#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { help, parseCliArgs } from './cli/options.mjs';
import { doctor } from './cli/doctor.mjs';
import { loadPlan } from './plan.mjs';
import { renderSettings } from './render/settings.mjs';

async function main() {
  const parsed = parseCliArgs();
  if (parsed.showHelp) return console.log(help);
  const { command, input, values, renderOptions } = parsed;
  if (command === 'doctor') {
    const report = await doctor();
    if (!report.ready) process.exitCode = 1;
    return console.log(JSON.stringify(report, null, 2));
  }
  if (command === 'validate') {
    const plan = await loadPlan(resolve(input));
    return console.log(JSON.stringify({ valid: true, steps: plan.steps.length, viewport: plan.viewport, device: plan.device?.name,
      note: 'Schema validated. Selectors and application state are checked during capture.' }, null, 2));
  }

  const beginning = performance.now();
  const directory = command === 'record'
    ? resolve(values.out ?? `recordings/${Date.now()}`) : resolve(input);
  const shouldRender = command === 'render' || !values['capture-only'];
  renderSettings(renderOptions);
  if (command === 'record') await loadPlan(resolve(input));
  process.stderr.write('Checking recording dependencies…\n');
  const health = await doctor({ capture: command === 'record', render: shouldRender });
  if (!health.ready) {
    throw new Error(health.checks.filter(check => !check.ok)
      .map(check => `${check.name}: ${check.error}\n${check.fix}`).join('\n'));
  }
  const timings = { preflightSeconds: (performance.now() - beginning) / 1000 };
  let result = { directory, status: 'captured' };
  if (command === 'record') {
    const { record } = await import('./record.mjs');
    process.stderr.write('Opening browser and capturing workflow…\n');
    const start = performance.now();
    const timeline = await record(resolve(input), directory, {
      headed: values.headed, storageState: values['storage-state'],
    });
    timings.recordSeconds = (performance.now() - start) / 1000;
    timings.browserSetupSeconds = timeline.setupSeconds;
    timings.videoSeconds = timeline.duration;
  }
  if (shouldRender) {
    process.stderr.write('Capture ready. Exporting video…\n');
    const start = performance.now();
    try {
      const { render } = await import('./render.mjs');
      result = await render(directory, renderOptions);
    } catch (error) {
      process.stderr.write(`Capture remains at ${directory}. Retry with render; do not repeat record.\n`);
      throw error;
    }
    timings.exportSeconds = (performance.now() - start) / 1000;
  }
  timings.totalSeconds = (performance.now() - beginning) / 1000;
  const workflow = { command, timings, note: 'CLI timings only; agent planning before invocation is not measured.' };
  await writeFile(join(directory, 'workflow.json'), JSON.stringify(workflow, null, 2));
  console.log(JSON.stringify({ ...result, workflow }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
