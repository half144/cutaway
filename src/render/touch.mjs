import { clamp, easeOut, pointerAt } from '../motion.mjs';

// Touch indicators in the style of iOS "show touches" tools: a translucent white disc the size of a
// fingertip (44 pt, ShowTime's default and Apple's minimum touch target) with a faint ring, so it reads
// on light and dark pages alike. It grows in as the finger lands, follows a drag, lingers a moment after
// the finger lifts (ShowTime: 0.2 s) and fades out while spreading, as Fingertips does (0.3 s, ~1.33×).
export const touchRadius = 22;
const appearSeconds = 0.08;
const lingerSeconds = 0.15;
const fadeSeconds = 0.3;

export function touchesAt(touches, time) {
  const states = [];
  for (const [id, touch] of touches.entries()) {
    if (touch.t > time) break;
    const release = clamp((time - touch.up - lingerSeconds) / fadeSeconds, 0, 1);
    if (release >= 1) continue;
    const point = time < touch.up ? pointerAt(touch.points, time).pointer : touch.points.at(-1);
    const down = easeOut(clamp((time - touch.t) / appearSeconds, 0, 1));
    states.push({
      id, x: point.x, y: point.y,
      alpha: down * (1 - release),
      scale: (0.75 + 0.25 * down) * (1 + 0.33 * easeOut(release)),
    });
  }
  return states;
}

// The touches drawn in each output frame, with where each one was a frame earlier for motion blur.
export class TouchTrack {
  constructor(timeline, fps) {
    this.touches = timeline.touches ?? [];
    this.fps = fps;
  }

  update(time) {
    const before = new Map(touchesAt(this.touches, time - 1 / this.fps).map(touch => [touch.id, touch]));
    const touches = touchesAt(this.touches, time).map(touch => {
      const previous = before.get(touch.id) ?? touch;
      return { ...touch, px: previous.x, py: previous.y };
    });
    return { touches, travel: Math.max(0, ...touches.map(touch => Math.hypot(touch.x - touch.px, touch.y - touch.py))) };
  }
}

// `unit` is output pixels per page pixel before the camera zoom; canvas shadows ignore the transform,
// so they are given in output pixels through `zoom`.
export function drawTouches(context, touches, unit, zoom) {
  for (const { x, y, alpha, scale } of touches) {
    if (alpha <= 0.002) continue;
    const radius = touchRadius * scale * unit;
    context.save();
    context.globalAlpha = alpha;
    context.shadowColor = '#00000030';
    context.shadowBlur = 5 * unit * zoom;
    context.shadowOffsetY = 1 * unit * zoom;
    context.fillStyle = '#ffffffa8';
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = '#0000003a';
    context.lineWidth = 1.5 * unit;
    context.beginPath();
    context.arc(x, y, radius - 0.75 * unit, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}
