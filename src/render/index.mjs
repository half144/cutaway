import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Camera, clamp, pointerAt } from '../motion.mjs';
import { backgrounds, createBackdrop } from './background.mjs';
import { cursorAppearance, cursorEvents, CursorVisibility } from './cursor.mjs';
import { VideoEncoder } from './encoder.mjs';
import { createFrame, drawOverlay, SceneRenderer } from './scene.mjs';
import { focusWindows, planFocusZooms, renewFocus, exportDuration } from './focus.mjs';
import { paceTimeline } from './pacing.mjs';
import { renderSettings } from './settings.mjs';

function mix(a, b, t) {
  return a + (b - a) * t;
}

function configureCanvas(canvas) {
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

export async function render(directory, options = {}) {
  const settings = renderSettings(options);
  const { width, height, fps, maxZoom, blur, cursorSize, padding, preset, pacing, quality } = settings;
  const sourceTimeline = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
  if (sourceTimeline.status !== 'complete' || !sourceTimeline.frames.length) {
    throw new Error('Cannot render an incomplete recording. Inspect timeline.json.');
  }
  const paced = paceTimeline(sourceTimeline, pacing);
  const timeline = paced.timeline;

  const focuses = planFocusZooms(focusWindows(timeline), timeline.viewport, maxZoom);
  const viewport = timeline.viewport;
  const { frame, ratio } = createFrame(width, height, viewport, padding);
  const backdrop = await createBackdrop(width, height, frame, backgrounds[preset]);
  const output = createCanvas(width, height);
  const sample = createCanvas(width, height);
  const overlay = createCanvas(width, height);
  const overlayContext = overlay.getContext('2d');
  const outputContext = output.getContext('2d');
  const sampleContext = configureCanvas(sample);
  const scene = new SceneRenderer(width, height);
  const camera = new Camera(viewport.width, viewport.height, { maxZoom });
  const outputPath = resolve(options.output ?? join(directory, 'video.mp4'));
  const encoder = new VideoEncoder(outputPath, width, height, fps, quality);

  const beginning = performance.now();
  const duration = exportDuration(timeline, focuses, maxZoom);
  const frameCount = Math.ceil(duration * fps);
  const visibility = new CursorVisibility();
  const cursorChanges = cursorEvents(timeline);
  const cameraTrack = [];
  let sourceIndex = -1;
  let source;
  let pointerIndex = 0;
  let focusIndex = -1;
  let clickIndex = -1;
  let cursorIndex = 0;
  let peakZoom = 1;
  let previousPoint;
  let previousState = { x: viewport.width / 2, y: viewport.height / 2, zoom: 1 };
  let rotation = 0;
  let maxRss = 0;

  try {
    for (let i = 0; i < frameCount; i++) {
      encoder.assertHealthy();
      const t = i / fps;

      let nextSourceIndex = Math.max(0, sourceIndex);
      while (nextSourceIndex + 1 < timeline.frames.length && timeline.frames[nextSourceIndex + 1].t <= t) {
        nextSourceIndex++;
      }
      if (nextSourceIndex !== sourceIndex) {
        sourceIndex = nextSourceIndex;
        source = await loadImage(join(directory, timeline.frames[sourceIndex].file));
      }

      const sampled = pointerAt(timeline.points, t, pointerIndex);
      pointerIndex = sampled.index;
      const point = sampled.pointer;
      const dx = previousPoint && point ? point.x - previousPoint.x : 0;
      const dy = previousPoint && point ? point.y - previousPoint.y : 0;

      while (focusIndex + 1 < focuses.length && focuses[focusIndex + 1].startAt <= t) {
        focusIndex++;
      }
      const active = focuses[focusIndex];
      if (t < timeline.duration) renewFocus(active, t, Math.hypot(dx, dy) * fps);
      const focus = active && t < timeline.duration && t <= active.releaseAt ? active : null;
      const state = camera.update(focus, focus?.manual ? null : point, 1 / fps);
      peakZoom = Math.max(peakZoom, state.zoom);
      cameraTrack.push({ t, ...state });

      while (clickIndex + 1 < timeline.clicks.length && timeline.clicks[clickIndex + 1].t <= t) {
        clickIndex++;
      }
      const clickAge = clickIndex >= 0 ? t - timeline.clicks[clickIndex].t : -1;
      const appearance = cursorAppearance(cursorChanges, t, cursorIndex);
      cursorIndex = appearance.index;
      const typing = focus?.action === 'type' && t >= focus.t && t <= (focus.interactionEnd ?? focus.end);
      const cursorActive = typing || Math.hypot(dx, dy) * fps > 7.2 || (clickAge >= 0 && clickAge < 0.15);
      const opacity = visibility.update(t, cursorActive, 1 / fps);
      const previousRotation = rotation;
      rotation = mix(rotation, clamp(dx * fps / 6500, -0.08, 0.08), 1 - Math.pow(0.82, 60 / fps));

      const cameraVelocity = Math.hypot(state.x - previousState.x, state.y - previousState.y) * ratio
        + Math.abs(state.zoom - previousState.zoom) * width;
      function sampleCount(velocity) {
        if (blur === 0 || velocity <= 0.6) return 1;
        return Math.min(quality === 'high' ? 8 : 5, Math.max(2, Math.ceil(velocity * blur / 2)));
      }
      const cameraSamples = sampleCount(cameraVelocity);
      const cursorSamples = sampleCount(cameraVelocity + Math.hypot(dx, dy) * ratio * state.zoom);

      function temporalSample(sampleIndex, samples) {
        const fraction = samples === 1 ? 1 : 1 - blur + blur * (sampleIndex + 0.5) / samples;
        const sampledPointer = point && {
          x: mix(previousPoint?.x ?? point.x, point.x, fraction),
          y: mix(previousPoint?.y ?? point.y, point.y, fraction),
        };
        return {
          width,
          height,
          backdrop,
          source,
          frame,
          viewport,
          camera: {
            x: mix(previousState.x, state.x, fraction),
            y: mix(previousState.y, state.y, fraction),
            zoom: mix(previousState.zoom, state.zoom, fraction),
          },
          pointer: sampledPointer,
          click: timeline.clicks[clickIndex],
          cursor: {
            ...appearance,
            rotation: mix(previousRotation, rotation, fraction),
            size: cursorSize * width / 1920 / mix(previousState.zoom, state.zoom, fraction),
            clickAge,
            opacity,
          },
        };
      }

      for (let sampleIndex = 0; sampleIndex < cameraSamples; sampleIndex++) {
        scene.drawPage(sampleContext, temporalSample(sampleIndex, cameraSamples));
        outputContext.globalAlpha = 1 / (sampleIndex + 1);
        outputContext.drawImage(sample, 0, 0);
      }

      // Cursor motion must not force the entire page through extra expensive blur samples.
      overlayContext.clearRect(0, 0, width, height);
      overlayContext.globalCompositeOperation = 'lighter';
      overlayContext.globalAlpha = 1 / cursorSamples;
      for (let sampleIndex = 0; sampleIndex < cursorSamples; sampleIndex++) {
        sampleContext.clearRect(0, 0, width, height);
        drawOverlay(sampleContext, temporalSample(sampleIndex, cursorSamples));
        overlayContext.drawImage(sample, 0, 0);
      }
      outputContext.globalAlpha = 1;
      outputContext.drawImage(overlay, 0, 0);
      await encoder.write(output.data());
      if (i === Math.floor(frameCount / 2)) {
        await writeFile(join(directory, 'poster.png'), await output.encode('png'));
      }
      if (i % (fps * 2) === 0) {
        maxRss = Math.max(maxRss, process.memoryUsage().rss);
        process.stderr.write(`Rendering ${Math.round(i / frameCount * 100)}%\n`);
      }
      previousState = state;
      previousPoint = point;
    }

    await encoder.finish();
  } catch (error) {
    await encoder.abort();
    throw error;
  }

  const elapsed = (performance.now() - beginning) / 1000;
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
    settings: { maxZoom, blur, cursorSize, padding, preset, pacing, quality },
    sourcePixels: { width: source.width, height: source.height },
    pageCache: { draws: scene.pageDraws, hits: scene.cacheHits },
    sourcePixelsPerOutputPixelAtMaxZoom: +(source.width / (frame.width * peakZoom)).toFixed(3),
    note: 'Camera and cursor rendered at output fps; source frames follow the browser compositor cadence.',
  };
  await writeFile(join(directory, 'render.json'), JSON.stringify(report, null, 2));
  await writeFile(join(directory, 'camera.json'), JSON.stringify(cameraTrack));
  return report;
}
