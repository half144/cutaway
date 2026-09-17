export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const ease = t => t * t * t * (10 + t * (-15 + t * 6));

function unitNoise(seed) {
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

function visibleRegion(focus, width, height) {
  const region = focus.framingContext ?? focus.context ?? focus;
  const x = clamp(region.x, 0, width);
  const y = clamp(region.y, 0, height);
  return { x, y,
    width: Math.max(0, clamp(region.x + region.width, 0, width) - x),
    height: Math.max(0, clamp(region.y + region.height, 0, height) - y) };
}

function fitCenter(current, min, max) {
  // An oversized region cannot fit the safe zone: center it instead of inverting the clamp.
  return min > max ? (min + max) / 2 : clamp(current, min, max);
}

export function focusZoom(focus, width, height, maxZoom, safeZone) {
  const region = visibleRegion(focus, width, height);
  let preferred = 1.35;
  if (focus.action === 'type') preferred = 1.5;
  if (focus.manual) preferred = 1.3;
  return Math.max(1, Math.min(maxZoom, preferred,
    width * safeZone / (region.width + 100),
    height * safeZone / (region.height + 90)));
}

export function pointerPath(from, to, duration, options = {}) {
  const settings = typeof options === 'number' ? { fps: options } : options;
  const { fps = 60, seed = 0, targetWidth = 40 } = settings;
  const count = Math.max(2, Math.ceil(duration * fps));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const base = motionSeed(from, to, seed);
  const side = unitNoise(base + 1) < 0.5 ? -1 : 1;
  const bend = side * Math.min(72, length * (0.055 + unitNoise(base + 2) * 0.035));
  const first = 0.24 + unitNoise(base + 3) * 0.08;
  const second = 0.68 + unitNoise(base + 4) * 0.09;
  const secondBend = bend * (0.28 + unitNoise(base + 5) * 0.32);
  const firstControl = {
    x: from.x + dx * first + nx * bend,
    y: from.y + dy * first + ny * bend,
  };
  const secondControl = {
    x: from.x + dx * second + nx * secondBend,
    y: from.y + dy * second + ny * secondBend,
  };
  const correction = length > 180 ? Math.min(7, targetWidth * 0.12, length * 0.012) : 0;
  const correctionSide = (unitNoise(base + 6) * 2 - 1) * (0.4 + unitNoise(base + 7) * 0.25);
  const settleStart = 0.76 + unitNoise(base + 8) * 0.04;

  return Array.from({ length: count + 1 }, (_, i) => {
    if (i === 0) return { t: 0, ...from };
    if (i === count) return { t: duration, ...to };
    const t = i / count;
    const progress = ease(t);
    const settle = clamp((t - settleStart) / (1 - settleStart), 0, 1);
    const settlePulse = Math.sin(Math.PI * settle) ** 2 * correction;
    return {
      t: duration * t,
      x: cubic(from.x, firstControl.x, secondControl.x, to.x, progress)
        + nx * settlePulse * correctionSide,
      y: cubic(from.y, firstControl.y, secondControl.y, to.y, progress)
        + ny * settlePulse * correctionSide,
    };
  });
}

// Exact critically damped spring: stable even when the output frame rate changes.
function spring(value, velocity, target, dt, omega = 10) {
  const offset = value - target;
  const impulse = velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  return [target + (offset + impulse * dt) * decay, (velocity - omega * impulse * dt) * decay];
}

export class Camera {
  constructor(width, height, { maxZoom = 1.8, safeZone = 0.65 } = {}) {
    this.width = width;
    this.height = height;
    this.maxZoom = maxZoom;
    this.safeZone = safeZone;
    this.x = this.targetX = width / 2;
    this.y = this.targetY = height / 2;
    this.zoom = 1;
    this.vx = this.vy = this.vz = 0;
    this.panX = this.panY = 0;
  }

  update(focus, pointer, dt) {
    let targetZoom = 1;
    if (focus) {
      targetZoom = focus.plannedZoom ?? focusZoom(focus, this.width, this.height, this.maxZoom, this.safeZone);
      const region = visibleRegion(focus, this.width, this.height);
      const halfX = this.width * this.safeZone / (2 * targetZoom);
      const halfY = this.height * this.safeZone / (2 * targetZoom);
      // Move only as far as needed to keep the interaction inside the safe region.
      this.targetX = fitCenter(this.targetX, region.x + region.width + 35 - halfX, region.x - 35 + halfX);
      this.targetY = fitCenter(this.targetY, region.y + region.height + 30 - halfY, region.y - 30 + halfY);
      if (pointer) {
        const px = this.width * 0.84 / (2 * targetZoom);
        const py = this.height * 0.84 / (2 * targetZoom);
        this.targetX = clamp(this.targetX, pointer.x - px, pointer.x + px);
        this.targetY = clamp(this.targetY, pointer.y - py, pointer.y + py);
      }
    } else {
      this.targetX = this.width / 2;
      this.targetY = this.height / 2;
    }
    const targetRangeX = this.width * (1 - 1 / targetZoom) / 2;
    const targetRangeY = this.height * (1 - 1 / targetZoom) / 2;
    this.targetX = clamp(this.targetX, this.width / 2 - targetRangeX, this.width / 2 + targetRangeX);
    this.targetY = clamp(this.targetY, this.height / 2 - targetRangeY, this.height / 2 + targetRangeY);
    const targetPanX = targetRangeX > 0 ? (this.targetX - this.width / 2) / targetRangeX : 0;
    const targetPanY = targetRangeY > 0 ? (this.targetY - this.height / 2) / targetRangeY : 0;

    // Animate within the available travel range. No post-spring position clamp can snap the camera.
    [this.zoom, this.vz] = spring(this.zoom, this.vz, targetZoom, dt, 5.8);
    [this.panX, this.vx] = spring(this.panX, this.vx, targetPanX, dt, 5.8);
    [this.panY, this.vy] = spring(this.panY, this.vy, targetPanY, dt, 5.8);
    this.x = this.width / 2 + this.panX * this.width * (1 - 1 / this.zoom) / 2;
    this.y = this.height / 2 + this.panY * this.height * (1 - 1 / this.zoom) / 2;
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
