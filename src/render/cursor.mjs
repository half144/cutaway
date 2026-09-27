import { clamp, mix, pointerAt } from '../motion.mjs';

const typeChangeSeconds = 0.2;
const pressSeconds = 0.13;
const pressedScale = 0.8;
const clickHold = 0.3;
const idleSeconds = 3.5;
// Like Cap, a hidden pointer is back 250 ms before it moves. Hiding for less would read as a blink.
const showLead = 0.25;
const minHidden = 0.5;
const fadeOutSeconds = 0.18;
const fadeInSeconds = 0.2;
// A camera move may carry a resting pointer this far (1/16 of the frame width) before it hides.
const dragShare = 1 / 16;
const dragLead = 0.1;

function cubicBezier(x1, y1, x2, y2) {
  const curve = (a, b, t) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return x => {
    if (x <= 0 || x >= 1) return clamp(x, 0, 1);
    let low = 0;
    let high = 1;
    for (let i = 0; i < 24; i++) {
      const middle = (low + high) / 2;
      if (curve(x1, x2, middle) < x) low = middle;
      else high = middle;
    }
    return curve(y1, y2, (low + high) / 2);
  };
}

// Screen Studio's cursor-type transition curve.
const typeEase = cubicBezier(0.44, 0.22, 0.26, 0.99);
const smoothstep = t => t * t * (3 - 2 * t);

export function cursorEvents(timeline) {
  return (timeline.cursors ?? []).filter((event, index, events) => !events[index + 1] || events[index + 1].t - event.t >= 0.08);
}

export function cursorAppearance(events, time, index = 0) {
  while (index + 1 < events.length && events[index + 1].t <= time) index++;
  const event = events[index];
  if (!event || event.t > time) return { index, type: 'arrow', blend: 1 };
  return {
    index,
    type: event.type,
    previousType: events[index - 1]?.type ?? 'arrow',
    blend: typeEase((time - event.t) / typeChangeSeconds),
  };
}

// Ease-out with a small overshoot: the released pointer springs a touch past its size and settles.
const releaseBack = t => 1 + 3.5 * (t - 1) ** 3 + 2.5 * (t - 1) ** 2;
const releaseSeconds = 0.22;

// Mouse down/up modeled like Screen Studio: the pointer is already squeezing as the button goes down,
// stays pressed while held (at most a brief tap, even when a busy page delays the release), and
// springs back after release.
export function pressScale(clicks, time) {
  let squeeze = 0;
  for (const click of clicks) {
    if (click.t - pressSeconds > time) break;
    const up = Math.min(click.up ?? click.t + 0.07, click.t + 0.14);
    const pressing = smoothstep(clamp((time - click.t + pressSeconds) / pressSeconds, 0, 1));
    const releasing = 1 - releaseBack(clamp((time - up) / releaseSeconds, 0, 1));
    const value = Math.min(pressing, releasing);
    if (Math.abs(value) > Math.abs(squeeze)) squeeze = value;
  }
  return 1 - (1 - pressedScale) * squeeze;
}

// Moments when typing starts. macOS hides the pointer then until the mouse moves again; a single
// Escape or Enter does not, so the pointer stays in view as it causes a visible change.
export function keyboardTimes(timeline) {
  return timeline.focuses.filter(focus => focus.action === 'type')
    .map(focus => focus.typingStart ?? focus.t + 0.35).sort((a, b) => a - b);
}

// When the hand moves: between consecutive samples that differ.
export function motionSpans(points = []) {
  const spans = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (a.x === b.x && a.y === b.y) continue;
    const last = spans.at(-1);
    if (last && a.t <= last.end) last.end = b.t;
    else spans.push({ start: a.t, end: b.t });
  }
  return spans;
}

function merge(spans) {
  const merged = [];
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

// When the pointer must be seen: while it moves (from shortly before), around clicks, and while it
// scrolls the page. Typing right after a click may hide it before the click's usual hold ends.
function visibleSpans(timeline, keyboard) {
  const moves = motionSpans(timeline.points).map(span => ({ start: span.start - showLead, end: span.end }));
  const clicks = (timeline.clicks ?? []).map(click => ({
    start: click.t - pressSeconds - showLead,
    end: Math.min((click.up ?? click.t) + clickHold, keyboard.find(time => time > click.t) ?? Infinity),
  }));
  const scrolls = (timeline.scrolls ?? []).filter(scroll => !scroll.automatic)
    .map(scroll => ({ start: scroll.start - showLead, end: scroll.end }));
  return merge([...moves, ...clicks, ...scrolls]);
}

// Camera moves that carry the resting pointer farther than `dragShare` of the frame, or out of it.
// The camera settling after the hand stops is part of the gesture: only a move that starts, or
// speeds up again, while the hand rests counts.
export function cameraDrags(timeline, { camera, ratio, width, height }) {
  const moves = motionSpans(timeline.points);
  const drags = [];
  let episode = null;
  let moveIndex = 0;
  let pointIndex = 0;
  for (let i = 1; i < camera.length; i++) {
    const { t } = camera[i];
    while (moveIndex < moves.length && moves[moveIndex].end < t) moveIndex++;
    const sampled = pointerAt(timeline.points, t, pointIndex);
    pointIndex = sampled.index;
    const point = sampled.pointer;
    if (!point || moves[moveIndex]?.start < t) {
      episode = { settling: true, slowest: Infinity };
      continue;
    }
    const screen = state => ({
      x: (point.x - state.x) * ratio * state.zoom + width / 2,
      y: (point.y - state.y) * ratio * state.zoom + height / 2,
    });
    const [from, to] = [screen(camera[i - 1]), screen(camera[i])];
    const step = Math.hypot(to.x - from.x, to.y - from.y);
    const speed = step / (t - camera[i - 1].t);
    if (speed < 12) {
      episode = null;
      continue;
    }
    if (!episode || (episode.settling && speed > episode.slowest * 1.5)) {
      episode = { start: camera[i - 1].t, travel: 0, slowest: speed };
    }
    episode.slowest = Math.min(episode.slowest, speed);
    if (episode.settling) continue;
    episode.travel += step;
    if (episode.drag) episode.drag.end = t;
    else if (to.x < 0 || to.x > width || to.y < 0 || to.y > height || episode.travel > width * dragShare) {
      episode.drag = { start: episode.start, end: t };
      drags.push(episode.drag);
    }
  }
  return drags;
}

// Spans in which the pointer is hidden: after 2.5 s without activity, while typing, and ahead of
// a camera move that would drag the resting pointer across the frame. Each ends shortly before the
// hand moves or clicks again; shorter hides are skipped instead of blinking the pointer.
export function hiddenSpans(timeline, drags = []) {
  const keyboard = keyboardTimes(timeline);
  const visible = visibleSpans(timeline, keyboard);
  const rests = [0, ...visible.map(span => span.end)]
    .filter(rest => !visible.some(span => span.end > rest && span.start <= rest + idleSeconds));
  const candidates = [...rests.map(rest => ({ time: rest + idleSeconds })), ...keyboard.map(time => ({ time })),
    ...drags.map(drag => ({ time: drag.start - dragLead, until: drag.end }))];
  const spans = [];
  for (const { time, until = Infinity } of candidates) {
    const start = visible.find(span => span.start <= time && time < span.end)?.end ?? time;
    const end = visible.find(span => span.start > start)?.start ?? Infinity;
    // A drag that is over by the time a click lets the pointer go needs no hiding.
    if (end - start >= minHidden && start < until) spans.push({ start, end });
  }
  const merged = merge(spans);
  // A pointer that would vanish before it ever moves is never shown, so the opening stays still.
  if (merged[0] && merged[0].start < (visible[0]?.start ?? Infinity)) merged[0].start = -fadeOutSeconds;
  return merged;
}

export function visibilityAt(spans, time) {
  let hidden = 0;
  for (const span of spans) {
    if (span.start > time) break;
    const out = smoothstep(clamp((time - span.start) / fadeOutSeconds, 0, 1));
    const back = smoothstep(clamp((time - span.end) / fadeInSeconds, 0, 1));
    hidden = Math.max(hidden, out * (1 - back));
  }
  return 1 - hidden;
}

// Screen Studio draws the pointer through a spring (its default: stiffness 470, damping 70, mass 3), so it
// glides after the hand instead of tracing it: starts ease in, turns round off, arrivals settle softly.
// Chasing a point slightly ahead cancels most of the lag.
const springOmega = Math.sqrt(470 / 3);
const springDamping = 70 / (2 * Math.sqrt(470 * 3));
const springLead = 0.06;
// Around each click the pointer is pinned to the exact spot, as Cap and openscreen do, so the smoothing
// never makes a click land beside its target.
const pinApproach = 0.22;
const pinRelease = 0.25;

export function pinWeight(clicks, time) {
  let weight = 0;
  for (const click of clicks) {
    if (click.t - pinApproach > time) break;
    const up = Math.min(click.up ?? click.t + 0.07, click.t + 0.14);
    const arriving = smoothstep(clamp((time - click.t + pinApproach) / (pinApproach - 0.04), 0, 1));
    const leaving = 1 - smoothstep(clamp((time - up) / pinRelease, 0, 1));
    weight = Math.max(weight, Math.min(arriving, leaving));
  }
  return weight;
}

// The pointer as drawn in each output frame: position, shape, visibility, tilt and click squeeze.
// `view` is the simulated camera per frame with the page-to-output scale, for hiding before drags.
export class CursorTrack {
  constructor(timeline, fps, view) {
    this.timeline = timeline;
    this.fps = fps;
    this.shapes = cursorEvents(timeline);
    this.hidden = hiddenSpans(timeline, view ? cameraDrags(timeline, view) : []);
    this.pointIndex = 0;
    this.aheadIndex = 0;
    this.shapeIndex = 0;
    this.point = null;
    this.spring = null;
    this.time = 0;
    this.rotation = 0;
  }

  // Follows `target` with the spring over `dt`, in small steps so the result doesn't depend on fps.
  glide(target, dt) {
    const spring = this.spring;
    const steps = Math.max(1, Math.round(dt * 480));
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      spring.vx += (springOmega ** 2 * (target.x - spring.x) - 2 * springDamping * springOmega * spring.vx) * h;
      spring.vy += (springOmega ** 2 * (target.y - spring.y) - 2 * springDamping * springOmega * spring.vy) * h;
      spring.x += spring.vx * h;
      spring.y += spring.vy * h;
    }
  }

  update(time) {
    const { timeline, fps } = this;
    const previous = this.point;
    const sampled = pointerAt(timeline.points, time, this.pointIndex);
    this.pointIndex = sampled.index;
    const hand = sampled.pointer;
    let point = hand;
    if (hand) {
      const ahead = pointerAt(timeline.points, time + springLead, this.aheadIndex);
      this.aheadIndex = ahead.index;
      if (this.spring) this.glide(ahead.pointer, time - this.time);
      else this.spring = { x: hand.x, y: hand.y, vx: 0, vy: 0 };
      const pin = pinWeight(timeline.clicks, time);
      point = { x: mix(this.spring.x, hand.x, pin), y: mix(this.spring.y, hand.y, pin) };
    }
    this.time = time;
    const dx = previous && point ? point.x - previous.x : 0;
    const dy = previous && point ? point.y - previous.y : 0;
    const appearance = cursorAppearance(this.shapes, time, this.shapeIndex);
    this.shapeIndex = appearance.index;

    const previousRotation = this.rotation;
    // A subtle tilt with horizontal speed, one degree per 480 px/s: about Cap's 4.5° on a brisk stroke.
    const tilt = clamp(dx * fps / 480, -8, 8) * Math.PI / 180;
    this.rotation = mix(this.rotation, tilt, 1 - Math.pow(0.8, 60 / fps));
    this.point = point;
    return {
      point,
      previous,
      travel: Math.hypot(dx, dy),
      appearance,
      opacity: visibilityAt(this.hidden, time),
      press: pressScale(timeline.clicks, time),
      rotation: this.rotation,
      previousRotation,
    };
  }
}
