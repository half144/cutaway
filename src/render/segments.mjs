import { availableParallelism, totalmem } from 'node:os';
import { cameraVelocity, sampleCount } from './compose.mjs';

// Each process holds full-resolution canvases, a decoded capture and an encoder: ~0.3 GB at 1080p, about
// four times that at 4K, so 2 GB each leaves headroom. Half the cores leaves room for the x264 threads;
// a run under two seconds costs more to start than it saves.
export function workerCount(frameCount, fps) {
  return Math.max(1, Math.min(Math.floor(availableParallelism() / 2), Math.floor(totalmem() / 2 ** 31),
    Math.floor(frameCount / (fps * 2))));
}

// Contiguous runs of about equal work. Reading a frame back for the encoder and rasterizing the page
// for a moving camera cost about the same (~20 ms at 1080p on an M4); each blur sample ~14 ms.
export function splitSegments(frames, count, settings) {
  const costs = frames.map((current, index) => {
    const velocity = cameraVelocity(frames[index - 1]?.camera ?? current.camera, current.camera, settings);
    const samples = sampleCount(velocity, settings);
    return 1 + (velocity > 0 ? 1 : 0) + (samples > 1 ? samples * 0.75 : 0);
  });
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  const segments = [];
  let start = 0;
  let done = 0;
  costs.forEach((cost, index) => {
    done += cost;
    if (segments.length < count - 1 && index < frames.length - 1 && done >= total * (segments.length + 1) / count) {
      segments.push({ start, end: index + 1 });
      start = index + 1;
    }
  });
  segments.push({ start, end: frames.length });
  return segments;
}
