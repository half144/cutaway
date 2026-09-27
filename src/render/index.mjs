import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mix } from '../motion.mjs';
import { backgrounds, createBackdrop } from './background.mjs';
import { VideoEncoder } from './encoder.mjs';
import { createFrame, drawOverlay, overlayBounds, SceneRenderer } from './scene.mjs';
import { drawKeys, keyEvents } from './keys.mjs';
import { motionMetrics } from './metrics.mjs';
import { paceTimeline } from './pacing.mjs';
import { stillFrames } from './stillness.mjs';
import { renderSettings } from './settings.mjs';
import { toolbarHeight, toolbarStyle } from './toolbar.mjs';
import { renderTracks } from './tracks.mjs';

export async function render(directory, options = {}) {
  const settings = renderSettings(options);
  const { width, height, fps, maxZoom, blur, cursorSize, padding, preset, pacing, quality, window: windowStyle, keys } = settings;
  const sourceTimeline = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
  if (sourceTimeline.status !== 'complete' || !sourceTimeline.frames.length) {
    throw new Error('Cannot render an incomplete recording. Inspect timeline.json.');
  }
  const paced = paceTimeline(sourceTimeline, pacing, pacing === 'balanced' ? await stillFrames(sourceTimeline, directory) : undefined);
  const timeline = paced.timeline;
  const viewport = timeline.viewport;

  const toolbar = windowStyle === 'browser' ? await toolbarStyle(timeline, directory) : null;
  const { frame, window, ratio, scene: sceneSize } = createFrame(width, height, viewport, padding, toolbar ? toolbarHeight : 0);
  const { shots, report: shotReport, duration, frames } = renderTracks(timeline, {
    scene: sceneSize, level: maxZoom, fps, top: toolbar ? -toolbarHeight : 0, ratio, width, height,
  });
  const backdrop = await createBackdrop(width, height, window, backgrounds[preset]);
  const output = createCanvas(width, height);
  const outputContext = output.getContext('2d');
  // Blur samples shift an output-resolution image by fractions of a pixel: bilinear is enough.
  outputContext.imageSmoothingQuality = 'low';
  const sample = createCanvas(width, height);
  const sampleContext = sample.getContext('2d');
  const overlay = createCanvas(width, height);
  const overlayContext = overlay.getContext('2d');
  overlayContext.globalCompositeOperation = 'lighter';
  const scene = new SceneRenderer(width, height);
  const outputPath = resolve(options.output ?? join(directory, 'video.mp4'));
  const encoder = new VideoEncoder(outputPath, width, height, fps, quality);

  const beginning = performance.now();
  const frameCount = frames.length;
  const keyOverlay = keyEvents(timeline, keys);
  let sourceIndex = -1;
  let source;
  let peakZoom = 1;
  let previousState = frames[0].camera;
  let maxRss = 0;

  // Samples at most ~2 output pixels apart, so fast pans smear smoothly instead of ghosting in steps.
  function sampleCount(velocity) {
    if (blur === 0 || velocity <= 0.6) return 1;
    return Math.min(quality === 'high' ? 16 : 5, Math.max(2, Math.ceil(velocity * blur / 2)));
  }

  try {
    for (let i = 0; i < frameCount; i++) {
      encoder.assertHealthy();
      const { t, camera: state, cursor } = frames[i];

      let nextSourceIndex = Math.max(0, sourceIndex);
      while (nextSourceIndex + 1 < timeline.frames.length && timeline.frames[nextSourceIndex + 1].t <= t) {
        nextSourceIndex++;
      }
      if (nextSourceIndex !== sourceIndex) {
        sourceIndex = nextSourceIndex;
        source = await loadImage(join(directory, timeline.frames[sourceIndex].file));
      }

      const { point, previous } = cursor;
      peakZoom = Math.max(peakZoom, state.zoom);

      function temporalSample(sampleIndex, samples) {
        const fraction = samples === 1 ? 1 : 1 - blur + blur * (sampleIndex + 0.5) / samples;
        const zoom = mix(previousState.zoom, state.zoom, fraction);
        // Part of the scene, the pointer grows gently with the zoom instead of staying pinned in size.
        const size = cursorSize * width / 1920 / Math.sqrt(zoom);
        return {
          width,
          height,
          backdrop,
          source,
          frame,
          viewport,
          toolbar,
          camera: { x: mix(previousState.x, state.x, fraction), y: mix(previousState.y, state.y, fraction), zoom },
          pointer: point && {
            x: mix(previous?.x ?? point.x, point.x, fraction),
            y: mix(previous?.y ?? point.y, point.y, fraction),
          },
          cursor: {
            ...cursor.appearance,
            rotation: mix(cursor.previousRotation, cursor.rotation, fraction),
            size,
            pixels: size * zoom,
            press: cursor.press,
            opacity: cursor.opacity,
          },
        };
      }

      // Largest output displacement this frame: the pan plus the zoom's reach at the frame corners.
      const cameraVelocity = Math.hypot(state.x - previousState.x, state.y - previousState.y) * ratio * state.zoom
        + Math.abs(state.zoom - previousState.zoom) / state.zoom * Math.hypot(width, height) / 2;
      const cameraSamples = sampleCount(cameraVelocity);
      scene.renderPage(temporalSample(0, 1));
      outputContext.drawImage(scene.page, 0, 0);
      if (cameraSamples > 1) {
        for (let sampleIndex = 0; sampleIndex < cameraSamples; sampleIndex++) {
          outputContext.globalAlpha = 1 / (sampleIndex + 1);
          scene.drawPageAs(outputContext, temporalSample(sampleIndex, cameraSamples));
        }
        outputContext.globalAlpha = 1;
      }

      if (point && cursor.opacity > 0.002) {
        const cursorSamples = sampleCount(cameraVelocity + cursor.travel * ratio * state.zoom);
        const cursorFrames = Array.from({ length: cursorSamples }, (_, sampleIndex) => temporalSample(sampleIndex, cursorSamples));
        const { x, y, right, bottom } = overlayBounds(cursorFrames);
        if (right > x && bottom > y) {
          // Average the cursor samples in isolation, then composite only the pixels they can touch.
          const area = [x, y, right - x, bottom - y];
          overlayContext.clearRect(...area);
          overlayContext.globalAlpha = 1 / cursorSamples;
          for (const cursorFrame of cursorFrames) {
            sampleContext.clearRect(...area);
            drawOverlay(sampleContext, cursorFrame);
            overlayContext.drawImage(sample, ...area, ...area);
          }
          outputContext.drawImage(overlay, ...area, ...area);
        }
      }
      drawKeys(outputContext, keyOverlay, t, width, height);

      await encoder.write(output.data());
      if (i === Math.floor(frameCount / 2)) {
        await writeFile(join(directory, 'poster.png'), await output.encode('png'));
      }
      if (i % (fps * 2) === 0) {
        maxRss = Math.max(maxRss, process.memoryUsage().rss);
        process.stderr.write(`Rendering ${Math.round(i / frameCount * 100)}%\n`);
      }
      previousState = state;
    }

    await encoder.finish();
  } catch (error) {
    await encoder.abort();
    throw error;
  }

  const elapsed = (performance.now() - beginning) / 1000;
  const cameraTrack = frames.map(({ t, camera }) => ({ t, ...camera }));
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
    sampledPeakRssMB: Math.round(maxRss / 1024 / 1024),
    settings: { maxZoom, blur, cursorSize, padding, preset, pacing, quality, window: windowStyle, keys },
    motion: motionMetrics(cameraTrack, { shots, report: shotReport, timeline }),
    sourcePixels: { width: source.width, height: source.height },
    pageCache: { draws: scene.pageDraws, hits: scene.cacheHits },
    sourcePixelsPerOutputPixelAtMaxZoom: +(source.width / (frame.width * peakZoom)).toFixed(3),
    note: 'Camera and cursor rendered at output fps; source frames follow the browser compositor cadence.',
  };
  await writeFile(join(directory, 'render.json'), JSON.stringify(report, null, 2));
  await writeFile(join(directory, 'camera.json'), JSON.stringify(cameraTrack));
  return report;
}
