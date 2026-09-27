import { createCanvas } from '@napi-rs/canvas';
import { drawCursor } from './cursor-art.mjs';
import { drawToolbar } from './toolbar.mjs';

const windowRadius = 12;

export function createFrame(width, height, viewport, padding, toolbar = 0) {
  const ratio = Math.min(width * (1 - padding * 2) / viewport.width,
    height * (1 - padding * 2) / (viewport.height + toolbar));
  const window = {
    width: viewport.width * ratio,
    height: (viewport.height + toolbar) * ratio,
    radius: windowRadius * ratio,
  };
  window.x = (width - window.width) / 2;
  window.y = (height - window.height) / 2;
  const frame = {
    x: window.x,
    y: window.y + toolbar * ratio,
    width: window.width,
    height: viewport.height * ratio,
    radius: window.radius,
    toolbar: toolbar * ratio,
  };
  return { frame, window, ratio, scene: { width: width / ratio, height: height / ratio } };
}

function scenePoint(point, frame, viewport) {
  return { x: frame.x + point.x * frame.width / viewport.width, y: frame.y + point.y * frame.height / viewport.height };
}

function transformScene(context, sample) {
  const { width, height, frame, viewport, camera } = sample;
  const center = scenePoint(camera, frame, viewport);
  context.translate(width / 2, height / 2);
  context.scale(camera.zoom, camera.zoom);
  context.translate(-center.x, -center.y);
}

function clipFrame(context, frame) {
  const r = frame.radius;
  context.beginPath();
  context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.toolbar ? [0, 0, r, r] : r);
  context.clip();
}

function drawPage(context, sample) {
  const { width, height, backdrop, source, frame, camera, toolbar } = sample;
  context.clearRect(0, 0, width, height);
  context.save();
  transformScene(context, sample);
  context.drawImage(backdrop, 0, 0);
  if (toolbar) drawToolbar(context, frame, toolbar);
  context.save();
  clipFrame(context, frame);
  // Cubic filtering softens even 1:1 pixels. Use it only when magnifying the source.
  context.imageSmoothingQuality = frame.width * camera.zoom > source.width * 1.02 ? 'high' : 'medium';
  context.drawImage(source, frame.x, frame.y, frame.width, frame.height);
  context.restore();
  context.restore();
}

export function drawOverlay(context, sample) {
  const { frame, viewport, pointer, cursor } = sample;
  context.save();
  transformScene(context, sample);
  clipFrame(context, frame);
  drawCursor(context, scenePoint(pointer, frame, viewport), cursor);
  context.restore();
}

// Output pixels the cursor samples can cover, so compositing touches only those.
export function overlayBounds(samples) {
  const { width, height } = samples[0];
  const reach = samples.map(({ frame, viewport, camera, pointer, cursor }) => {
    const point = scenePoint(pointer, frame, viewport);
    const center = scenePoint(camera, frame, viewport);
    const x = (point.x - center.x) * camera.zoom + width / 2;
    const y = (point.y - center.y) * camera.zoom + height / 2;
    const radius = 34 * cursor.size * camera.zoom + 8;
    return { x: x - radius, y: y - radius, right: x + radius, bottom: y + radius };
  });
  return {
    x: Math.max(0, Math.floor(Math.min(...reach.map(bounds => bounds.x)))),
    y: Math.max(0, Math.floor(Math.min(...reach.map(bounds => bounds.y)))),
    right: Math.min(width, Math.ceil(Math.max(...reach.map(bounds => bounds.right)))),
    bottom: Math.min(height, Math.ceil(Math.max(...reach.map(bounds => bounds.bottom)))),
  };
}

// Cache only a final-resolution page, never a smaller intermediate that zoom would enlarge.
export class SceneRenderer {
  constructor(width, height) {
    this.page = createCanvas(width, height);
    this.context = this.page.getContext('2d');
    this.context.imageSmoothingQuality = 'high';
    this.cachedSource = null;
    this.cachedCamera = null;
    this.pageDraws = 0;
    this.cacheHits = 0;
  }

  // Rasterizes the page once for the frame's camera; the cache survives cursor-only frames.
  renderPage(sample) {
    const { camera, source, frame, viewport, width, height } = sample;
    const previous = this.cachedCamera;
    const panError = previous ? Math.hypot(camera.x - previous.x, camera.y - previous.y)
      * frame.width / viewport.width * camera.zoom : Infinity;
    const scaleError = previous ? Math.abs(camera.zoom - previous.zoom) * Math.max(width, height) : Infinity;
    // At most 1/100 of an output pixel; prevents rerasterizing imperceptible spring tails.
    if (source !== this.cachedSource || panError + scaleError > 0.01) {
      drawPage(this.context, sample);
      this.cachedSource = source;
      this.cachedCamera = { ...camera };
      this.pageDraws++;
    } else {
      this.cacheHits++;
    }
  }

  // Draws the cached page as seen from `camera`. Blur samples differ from the cached camera by
  // a fraction of a frame of motion, so a small affine resample of the output replaces a full
  // rasterization of the high-density capture for each of them.
  drawPageAs(context, sample) {
    const { camera, frame, viewport, width, height } = sample;
    const cached = this.cachedCamera;
    const scale = camera.zoom / cached.zoom;
    const shift = {
      x: (cached.x - camera.x) * frame.width / viewport.width * camera.zoom,
      y: (cached.y - camera.y) * frame.height / viewport.height * camera.zoom,
    };
    context.save();
    context.translate(width / 2 + shift.x, height / 2 + shift.y);
    context.scale(scale, scale);
    context.translate(-width / 2, -height / 2);
    context.drawImage(this.page, 0, 0);
    context.restore();
  }
}
