import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concatSegments } from './encoder.mjs';
import { createDeviceFrame, deviceLayout } from './device.mjs';
import { createFrame } from './scene.mjs';
import { keyEvents } from './keys.mjs';
import { motionMetrics } from './metrics.mjs';
import { paceTimeline } from './pacing.mjs';
import { splitSegments, workerCount } from './segments.mjs';
import { stillFrames } from './stillness.mjs';
import { renderSettings } from './settings.mjs';
import { toolbarHeight, toolbarStyle } from './toolbar.mjs';
import { renderTracks } from './tracks.mjs';

const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));

function startWorker(job, onProgress) {
  const child = fork(workerPath, { serialization: 'advanced' });
  const exited = new Promise(resolveExit => child.once('exit', resolveExit));
  const done = new Promise((resolveResult, reject) => {
    child.on('message', message => {
      if (message.progress !== undefined) onProgress(message.progress);
      else if (message.error) reject(new Error(message.error));
      else resolveResult(message.result);
    });
    child.once('exit', code => reject(new Error(`Render worker exited (${code}) before finishing.`)));
  });
  child.send(job);
  return { child, done, exited };
}

// A phone recording exports as a vertical video with the phone around the page.
const phoneDefaults = { width: 1080, height: 1920, window: 'device' };

export async function render(directory, options = {}) {
  const sourceTimeline = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
  if (sourceTimeline.status !== 'complete' || !sourceTimeline.frames.length) {
    throw new Error('Cannot render an incomplete recording. Inspect timeline.json.');
  }
  const settings = renderSettings({ ...(sourceTimeline.device && phoneDefaults), ...options });
  const { width, height, fps, maxZoom, blur, cursorSize, padding, preset, pacing, quality, window: windowStyle, keys } = settings;
  if (windowStyle === 'device' && !sourceTimeline.device) {
    throw new Error('--window device needs a recording made with a phone "device" in the plan.');
  }
  const paced = paceTimeline(sourceTimeline, pacing, pacing === 'balanced' ? await stillFrames(sourceTimeline, directory) : undefined);
  const timeline = paced.timeline;
  const viewport = timeline.viewport;

  const toolbar = windowStyle === 'browser' ? await toolbarStyle(timeline, directory) : null;
  const device = windowStyle === 'device' ? deviceLayout(timeline.device, viewport) : null;
  const { frame, window, ratio, scene: sceneSize, bounds } = device
    ? createDeviceFrame(width, height, viewport, padding, device)
    : createFrame(width, height, viewport, padding, toolbar ? toolbarHeight : 0);
  const { shots, report: shotReport, duration, frames, keyboard } = renderTracks(timeline, {
    scene: sceneSize, level: maxZoom, fps, top: toolbar ? -toolbarHeight : 0, bounds, ratio, width, height, keyboard: Boolean(device),
  });
  const outputPath = resolve(options.output ?? join(directory, 'video.mp4'));
  const partsDirectory = `${outputPath}.${randomUUID()}.parts`;

  const beginning = performance.now();
  const frameCount = frames.length;
  const segments = splitSegments(frames, options.workers ?? workerCount(frameCount, fps), { ...settings, ratio });
  const shared = {
    directory: resolve(directory),
    settings,
    geometry: { frame, window, ratio, viewport, device },
    toolbar,
    sources: timeline.frames,
    // A return key pressed on the phone's keyboard is seen there, not in the shortcut pill.
    keyOverlay: keyEvents(timeline, keys).filter(event => !keyboard.some(span => span.keys.some(key => key.key === '\n' && key.t === event.t))),
    posterIndex: Math.floor(frameCount / 2),
  };
  let rendered = 0;
  let reported = -1;
  function progress(count) {
    rendered += count;
    const percent = Math.floor(rendered / frameCount * 20) * 5;
    if (percent > reported) process.stderr.write(`Rendering ${percent}%\n`);
    reported = Math.max(reported, percent);
  }

  const paths = segments.map((_, index) => join(partsDirectory, `${index}.mp4`));
  const workers = [];
  let results;
  try {
    await mkdir(partsDirectory, { recursive: true });
    for (const [index, { start, end }] of segments.entries()) {
      workers.push(startWorker({
        ...shared,
        frames: frames.slice(start, end),
        previous: frames[Math.max(0, start - 1)].camera,
        start,
        path: paths[index],
      }, progress));
    }
    results = await Promise.all(workers.map(worker => worker.done));
    await concatSegments(paths, outputPath);
  } finally {
    for (const { child } of workers) if (child.connected) child.disconnect();
    await Promise.all(workers.map(worker => worker.exited));
    await rm(partsDirectory, { recursive: true, force: true });
  }

  const elapsed = (performance.now() - beginning) / 1000;
  const cameraTrack = frames.map(({ t, camera }) => ({ t, ...camera }));
  const peakZoom = Math.max(...cameraTrack.map(camera => camera.zoom));
  const { sourcePixels } = results[0];
  const report = {
    output: outputPath,
    duration,
    capturedDuration: sourceTimeline.duration,
    contentDuration: timeline.duration,
    closingHoldSeconds: +(duration - timeline.duration).toFixed(3),
    pacing: paced.report,
    width,
    height,
    fps,
    capturedFrames: timeline.frames.length,
    outputFrames: frameCount,
    renderSeconds: +elapsed.toFixed(2),
    renderFps: +(frameCount / elapsed).toFixed(1),
    renderProcesses: segments.length,
    sampledPeakRssMB: Math.round(results.reduce((sum, result) => sum + result.peakRss, 0) / 1024 / 1024),
    settings: { maxZoom, blur, cursorSize, padding, preset, pacing, quality, window: windowStyle, keys },
    motion: motionMetrics(cameraTrack, { shots, report: shotReport, timeline }),
    sourcePixels,
    pageCache: {
      draws: results.reduce((sum, result) => sum + result.pageDraws, 0),
      hits: results.reduce((sum, result) => sum + result.cacheHits, 0),
    },
    sourcePixelsPerOutputPixelAtMaxZoom: +(sourcePixels.width / (frame.width * peakZoom)).toFixed(3),
    note: 'Camera and cursor rendered at output fps; source frames follow the browser compositor cadence.',
  };
  await writeFile(join(directory, 'render.json'), JSON.stringify(report, null, 2));
  await writeFile(join(directory, 'camera.json'), JSON.stringify(cameraTrack));
  return report;
}
