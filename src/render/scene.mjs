import { createCanvas } from '@napi-rs/canvas';
import { drawClick, drawCursor } from './cursor-art.mjs';

export function createFrame(width, height, viewport, padding) {
  const ratio = Math.min(width * (1 - padding * 2) / viewport.width, height * (1 - padding * 2) / viewport.height);
  const frame = {
    width: viewport.width * ratio,
    height: viewport.height * ratio,
    radius: 16 * width / 1920,
  };
  frame.x = (width - frame.width) / 2;
  frame.y = (height - frame.height) / 2;
  return { frame, ratio };
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
  context.beginPath();
  context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.radius);
  context.clip();
}

function drawPage(context, sample) {
  const { width, height, backdrop, source, frame, camera } = sample;
  context.clearRect(0, 0, width, height);
  context.save();
  transformScene(context, sample);
  context.drawImage(backdrop, 0, 0);
  context.save();
  clipFrame(context, frame);
  // Cubic filtering softens even 1:1 pixels. Use it only when magnifying the source.
  context.imageSmoothingQuality = frame.width * camera.zoom > source.width * 1.02 ? 'high' : 'medium';
  context.drawImage(source, frame.x, frame.y, frame.width, frame.height);
  context.restore();
  context.strokeStyle = '#ffffff32';
  context.lineWidth = width / 1920;
  context.beginPath();
  context.roundRect(frame.x + 0.5, frame.y + 0.5, frame.width - 1, frame.height - 1, frame.radius);
  context.stroke();
  context.restore();
}

export function drawOverlay(context, sample) {
  const { width, frame, viewport, camera, pointer, cursor, click } = sample;
  context.save();
  transformScene(context, sample);
  clipFrame(context, frame);
  if (click) drawClick(context, scenePoint(click, frame, viewport), cursor.clickAge, width / 1920 / camera.zoom);
  if (pointer) drawCursor(context, scenePoint(pointer, frame, viewport), cursor);
  context.restore();
}

export function drawSample(context, sample) {
  drawPage(context, sample);
  drawOverlay(context, sample);
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

  drawPage(context, sample) {
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
    context.clearRect(0, 0, width, height);
    context.drawImage(this.page, 0, 0);
  }

  draw(context, sample) {
    this.drawPage(context, sample);
    drawOverlay(context, sample);
  }
}
