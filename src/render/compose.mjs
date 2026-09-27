import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mix } from '../motion.mjs';
import { backgrounds, createBackdrop } from './background.mjs';
import { VideoEncoder } from './encoder.mjs';
import { drawKeys } from './keys.mjs';
import { drawOverlay, overlayBounds, SceneRenderer } from './scene.mjs';

// Largest output displacement between two frames: the pan plus the zoom's reach at the frame corners.
export function cameraVelocity(previous, state, { ratio, width, height }) {
  return Math.hypot(state.x - previous.x, state.y - previous.y) * ratio * state.zoom
    + Math.abs(state.zoom - previous.zoom) / state.zoom * Math.hypot(width, height) / 2;
}

// Samples at most ~2 output pixels apart, so fast pans smear smoothly instead of ghosting in steps.
export function sampleCount(velocity, { blur, quality }) {
  if (blur === 0 || velocity <= 0.6) return 1;
  return Math.min(quality === 'high' ? 16 : 5, Math.max(2, Math.ceil(velocity * blur / 2)));
}

// Composes a run of output frames into one video segment. A frame needs only its own camera and cursor
// state and the camera of the frame before, so separate processes can render runs in parallel.
export async function composeSegment(job, { onProgress, signal } = {}) {
  const { directory, settings, geometry, toolbar, sources, keyOverlay, frames, previous, start, posterIndex, path } = job;
  const { width, height, fps, blur, cursorSize, preset, quality } = settings;
  const { frame, window, ratio, viewport, device } = geometry;
  const backdrop = await createBackdrop(width, height, window, backgrounds[preset], device);
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
  const encoder = new VideoEncoder(path, width, height, fps, quality);

  let sourceIndex = -1;
  let source;
  let previousState = previous;
  let maxRss = 0;

  try {
    for (const [offset, { t, camera: state, cursor, keyboard }] of frames.entries()) {
      signal?.throwIfAborted();
      encoder.assertHealthy();

      let nextSourceIndex = Math.max(0, sourceIndex);
      while (nextSourceIndex + 1 < sources.length && sources[nextSourceIndex + 1].t <= t) nextSourceIndex++;
      if (nextSourceIndex !== sourceIndex) {
        sourceIndex = nextSourceIndex;
        // Read first: loadImage reports a missing file as "Invalid URL".
        source = await loadImage(await readFile(join(directory, sources[sourceIndex].file)));
      }

      const { point, previous: previousPoint } = cursor;

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
          device,
          keyboard,
          camera: { x: mix(previousState.x, state.x, fraction), y: mix(previousState.y, state.y, fraction), zoom },
          touches: cursor.touches?.map(({ x, y, px, py, alpha, scale }) => ({
            x: mix(px, x, fraction), y: mix(py, y, fraction), alpha, scale,
          })),
          pointer: point && {
            x: mix(previousPoint?.x ?? point.x, point.x, fraction),
            y: mix(previousPoint?.y ?? point.y, point.y, fraction),
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

      const velocity = cameraVelocity(previousState, state, { ratio, width, height });
      const cameraSamples = sampleCount(velocity, { blur, quality });
      scene.renderPage(temporalSample(0, 1));
      outputContext.drawImage(scene.page, 0, 0);
      if (cameraSamples > 1) {
        for (let sampleIndex = 0; sampleIndex < cameraSamples; sampleIndex++) {
          outputContext.globalAlpha = 1 / (sampleIndex + 1);
          scene.drawPageAs(outputContext, temporalSample(sampleIndex, cameraSamples));
        }
        outputContext.globalAlpha = 1;
      }

      if (cursor.touches ? cursor.touches.length : point && cursor.opacity > 0.002) {
        const cursorSamples = sampleCount(velocity + cursor.travel * ratio * state.zoom, { blur, quality });
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
      if (start + offset === posterIndex) {
        await writeFile(join(directory, 'poster.png'), await output.encode('png'));
      }
      if ((offset + 1) % (fps * 2) === 0) {
        maxRss = Math.max(maxRss, process.memoryUsage().rss);
        onProgress?.(fps * 2);
      }
      previousState = state;
    }

    await encoder.finish();
  } catch (error) {
    await encoder.abort();
    throw error;
  }
  onProgress?.(frames.length % (fps * 2));

  return {
    pageDraws: scene.pageDraws,
    cacheHits: scene.cacheHits,
    peakRss: Math.max(maxRss, process.memoryUsage().rss),
    sourcePixels: { width: source.width, height: source.height },
  };
}
