export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const mix = (a, b, t) => a + (b - a) * t;
export const ease = t => t * t * t * (10 + t * (-15 + t * 6));
export const easeOut = t => 1 - (1 - t) ** 3;

export function unitNoise(seed) {
  let value = seed | 0;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 0x100000000;
}

function motionSeed(from, to, seed) {
  return Math.imul(Math.round(from.x * 8), 73856093)
    ^ Math.imul(Math.round(from.y * 8), 19349663)
    ^ Math.imul(Math.round(to.x * 8), 83492791)
    ^ Math.imul(Math.round(to.y * 8), 2654435761)
    ^ Math.imul(seed + 1, 1597334677);
}

function cubic(a, b, c, d, t) {
  const inverse = 1 - t;
  return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
}

export function targetPoint(box, seed = 0) {
  const base = motionSeed({ x: box.x, y: box.y }, { x: box.width, y: box.height }, seed);
  const offsetX = Math.min(12, box.width * 0.12, Math.max(0, box.width / 2 - 3));
  const offsetY = Math.min(7, box.height * 0.12, Math.max(0, box.height / 2 - 3));
  return {
    x: box.x + box.width / 2 + (unitNoise(base + 1) * 2 - 1) * offsetX,
    y: box.y + box.height / 2 + (unitNoise(base + 2) * 2 - 1) * offsetY,
  };
}

// Minimum-jerk stroke time-warped so speed peaks at ~42% of the stroke, as in aimed hand movements.
const stroke = t => ease(clamp(t, 0, 1) ** 0.82);

export function pointerPath(from, to, duration, options = {}) {
  const { fps = 60, seed = 0, targetWidth = 40 } = options;
  const count = Math.max(2, Math.ceil(duration * fps));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const base = motionSeed(from, to, seed);
  // Wrist and elbow rotation bow strokes consistently: horizontal ones upward, vertical ones outward.
  let nx = -uy;
  let ny = ux;
  const horizontal = Math.abs(ux) >= Math.abs(uy);
  if (horizontal ? ny > 0 : nx < 0) {
    nx = -nx;
    ny = -ny;
  }
  // A visible arc, 4–7% of the distance at its widest (~0.56 of the control offset), like a hand
  // pivoting at the wrist; a near-straight line reads as a machine.
  const bend = Math.min(90 + 30 * unitNoise(base + 6), length * (0.075 + 0.045 * unitNoise(base + 2))) * (horizontal ? 1 : 0.7);
  const first = 0.26 + 0.08 * unitNoise(base + 4);
  const second = 0.68 + 0.08 * unitNoise(base + 5);
  const firstControl = { x: from.x + dx * first + nx * bend, y: from.y + dy * first + ny * bend };
  const secondControl = { x: from.x + dx * second + nx * bend * 0.45, y: from.y + dy * second + ny * bend * 0.45 };

  // A long stroke to a small target lands a little short and a brief overlapping correction (≤ 120 ms)
  // finishes along the same arc. Larger targets are hit in one stroke: a slow creep reads as sluggish.
  const correction = Math.min(0.12, duration * 0.2) / duration;
  const undershoot = length > 220 && targetWidth < 24 ? Math.min(20, length * 0.035) * (0.7 + unitNoise(base + 3) * 0.6) / length : 0;
  const primaryEnd = undershoot ? 1 - correction * 0.6 : 1;
  const correctionStart = 1 - correction;
  const progress = t => (1 - undershoot) * stroke(t / primaryEnd)
    + undershoot * ease(clamp((t - correctionStart) / (1 - correctionStart), 0, 1));

  return Array.from({ length: count + 1 }, (_, i) => {
    if (i === 0) return { t: 0, ...from };
    if (i === count) return { t: duration, ...to };
    const t = i / count;
    const s = progress(t);
    return {
      t: duration * t,
      x: cubic(from.x, firstControl.x, secondControl.x, to.x, s),
      y: cubic(from.y, firstControl.y, secondControl.y, to.y, s),
    };
  });
}

// Exact critically damped spring: stable even when the output frame rate changes.
function spring(value, velocity, target, dt, omega) {
  const offset = value - target;
  const impulse = velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  return [target + (offset + impulse * dt) * decay, (velocity - omega * impulse * dt) * decay];
}

// Screen Studio's zoom leaves promptly, is mostly done by ~0.6 s and fades out by ~1.2 s.
// A fast first stage rounds off the onset so the move never starts with a single-frame kick.
const cameraOmegas = [30, 7.2];
// Like Screen Studio, the camera may reveal wallpaper near an edge, but only about this share of the view.
const maxBleed = 0.1;
// A close-up keeps its subject, plus this margin in page pixels, within the middle of the frame.
export const safeZone = 0.7;
export const framingMargin = { x: 32, y: 24 };

function fitCenter(current, min, max) {
  // An oversized region cannot fit the safe zone: center it instead of inverting the clamp.
  return min > max ? (min + max) / 2 : clamp(current, min, max);
}

export class Camera {
  // Coordinates are page pixels. `top` extends the window above the page (browser toolbar); `bounds`
  // is the whole window when it also extends elsewhere (a phone's body). `sceneWidth`/`sceneHeight`
  // are the full output measured in page pixels at zoom 1. `lockX` keeps the view centered
  // horizontally: a phone screen fits the width at every zoom, so the camera only travels up and down.
  constructor(width, height, {
    top = 0, bounds = { x: 0, y: top, width, height: height - top },
    sceneWidth = bounds.width, sceneHeight = bounds.height, lockX = false,
  } = {}) {
    this.width = width;
    this.height = height;
    this.bounds = bounds;
    this.sceneWidth = sceneWidth;
    this.sceneHeight = sceneHeight;
    this.lockX = lockX;
    this.centerX = bounds.x + bounds.width / 2;
    this.centerY = bounds.y + bounds.height / 2;
    this.padX = Math.max(0, (sceneWidth - bounds.width) / 2);
    this.padY = Math.max(0, (sceneHeight - bounds.height) / 2);
    // Never below the overview padding, so travel opens as soon as the zoom starts.
    this.bleedX = Math.max(maxBleed, this.padX / sceneWidth) * sceneWidth;
    this.bleedY = Math.max(maxBleed, this.padY / sceneHeight) * sceneHeight;
    this.x = this.targetX = this.centerX;
    this.y = this.targetY = this.centerY;
    this.zoom = 1;
    this.panX = this.panY = 0;
    this.stages = cameraOmegas.map(() => ({ zoom: 0, panX: 0, panY: 0, vz: 0, vx: 0, vy: 0 }));
    this.shot = null;
  }

  rangeX(zoom) {
    const bleed = Math.min(this.padX, this.bleedX / zoom);
    return Math.max(0, this.bounds.width / 2 + bleed - this.sceneWidth / (2 * zoom));
  }

  rangeY(zoom) {
    const bleed = Math.min(this.padY, this.bleedY / zoom);
    return Math.max(0, this.bounds.height / 2 + bleed - this.sceneHeight / (2 * zoom));
  }

  // `response` scales the main spring: quicker when the next change is imminent, calmer before a long
  // hold, so camera moves don't all share one duration (Screenize ties response to time-to-next-action).
  update(focus, pointer, dt, response = 1) {
    let targetZoom = 1;
    if (focus) {
      targetZoom = focus.plannedZoom;
      const region = {
        x: clamp(focus.x, 0, this.width),
        y: clamp(focus.y, 0, this.height),
      };
      region.width = clamp(focus.x + focus.width, 0, this.width) - region.x;
      region.height = clamp(focus.y + focus.height, 0, this.height) - region.y;
      if (focus.shot !== this.shot) {
        // A new shot frames its subject centrally; within a shot the camera moves only as needed.
        this.targetX = region.x + region.width / 2;
        this.targetY = region.y + region.height / 2;
      }
      const halfX = this.sceneWidth * safeZone / (2 * targetZoom);
      const halfY = this.sceneHeight * safeZone / (2 * targetZoom);
      const { x: marginX, y: marginY } = framingMargin;
      this.targetX = fitCenter(this.targetX, region.x + region.width + marginX - halfX, region.x - marginX + halfX);
      this.targetY = fitCenter(this.targetY, region.y + region.height + marginY - halfY, region.y - marginY + halfY);
      if (pointer) {
        // Follow the pointer like Screen Studio: it may roam the middle 60% before the camera moves along.
        const px = this.sceneWidth * 0.6 / (2 * targetZoom);
        const py = this.sceneHeight * 0.6 / (2 * targetZoom);
        this.targetX = clamp(this.targetX, pointer.x - px, pointer.x + px);
        this.targetY = clamp(this.targetY, pointer.y - py, pointer.y + py);
      }
    }
    this.shot = focus?.shot ?? null;

    // Panning is expressed as a fraction of the travel available at the current zoom,
    // so zooming out can never drag the view outside its bounds or require a snapping clamp.
    const target = { zoom: Math.log(targetZoom), panX: this.panX, panY: this.panY };
    if (focus) {
      const rangeX = this.rangeX(targetZoom);
      const rangeY = this.rangeY(targetZoom);
      target.panX = rangeX > 0 && !this.lockX ? clamp((this.targetX - this.centerX) / rangeX, -1, 1) : 0;
      target.panY = rangeY > 0 ? clamp((this.targetY - this.centerY) / rangeY, -1, 1) : 0;
      if (this.zoom < 1.0005) {
        // Travel is zero at 1×: aim first so the zoom grows straight into its subject.
        for (const stage of this.stages) Object.assign(stage, { panX: target.panX, panY: target.panY, vx: 0, vy: 0 });
      }
    }
    // Without a focus the last framing is held, so zooming out recedes from the same point.
    this.panX = target.panX;
    this.panY = target.panY;
    // Fixed substeps keep the cascade identical at 24, 30 or 60 fps exports.
    const substeps = Math.max(1, Math.round(dt * 240));
    for (let i = 0; i < substeps; i++) {
      let goal = target;
      this.stages.forEach((stage, index) => {
        const omega = cameraOmegas[index] * (index === cameraOmegas.length - 1 ? response : 1);
        [stage.zoom, stage.vz] = spring(stage.zoom, stage.vz, goal.zoom, dt / substeps, omega);
        [stage.panX, stage.vx] = spring(stage.panX, stage.vx, goal.panX, dt / substeps, omega);
        [stage.panY, stage.vy] = spring(stage.panY, stage.vy, goal.panY, dt / substeps, omega);
        goal = stage;
      });
    }
    const final = this.stages.at(-1);
    this.zoom = Math.exp(final.zoom);
    this.x = this.centerX + final.panX * this.rangeX(this.zoom);
    this.y = this.centerY + final.panY * this.rangeY(this.zoom);
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
}

export function pointerAt(points, time, index = 0) {
  while (index + 1 < points.length && points[index + 1].t <= time) index++;
  const a = points[index];
  const b = points[index + 1];
  if (!a) return { pointer: null, index };
  if (!b || time <= a.t) return { pointer: a, index };
  const duration = b.t - a.t;
  const k = clamp((time - a.t) / duration, 0, 1);
  function coordinate(key) {
    const slope = (b[key] - a[key]) / duration;
    const before = points[index - 1];
    const after = points[index + 2];
    const start = tangent(before, a, b, key);
    const end = tangent(a, b, after, key);
    // Monotone cubic interpolation preserves the exact samples and click timing, with no overshoot.
    return a[key] + duration * (start * k + (3 * slope - 2 * start - end) * k * k
      + (start + end - 2 * slope) * k * k * k);
  }
  return { pointer: { x: coordinate('x'), y: coordinate('y') }, index };
}

function tangent(a, b, c, key) {
  if (!a || !c) return 0;
  const left = b.t - a.t;
  const right = c.t - b.t;
  if (left <= 0 || right <= 0) return 0;
  const v1 = (b[key] - a[key]) / left;
  const v2 = (c[key] - b[key]) / right;
  if (v1 * v2 <= 0) return 0;
  const w1 = 2 * right + left;
  const w2 = right + 2 * left;
  return (w1 + w2) / (w1 / v1 + w2 / v2);
}
