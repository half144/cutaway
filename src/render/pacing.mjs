const idleThreshold = 2.6;
const preservedEdge = 0.55;
// Dead time shorter than a pause for a breath is kept; longer stretches keep a beat of stillness on
// each side and pass their middle faster. Nothing moves, so the speed-up is invisible.
const staticThreshold = 1.1;
const staticEdge = 0.35;
const staticSpeed = 3.5;
// An explicit focus holds its subject this long for reading before any trimming.
const focusReading = 1.8;

function pacedIdleDuration(duration) {
  if (duration <= idleThreshold) return duration;
  const minimum = preservedEdge * 2 + 0.45 + (duration - preservedEdge * 2 - 0.45) / 4;
  return Math.max(minimum, idleThreshold + Math.log1p(duration - idleThreshold) * 0.18);
}

function makeIdleSegment(start, end, kind) {
  const duration = end - start;
  if (!Number.isFinite(duration) || duration <= idleThreshold) return null;
  return { start, end, duration: pacedIdleDuration(duration), kind };
}

function subtract(span, busy) {
  let pieces = [span];
  for (const block of busy) {
    pieces = pieces.flatMap(piece => block.end <= piece.start || block.start >= piece.end ? [piece] : [
      ...(block.start > piece.start ? [{ start: piece.start, end: block.start }] : []),
      ...(block.end < piece.end ? [{ start: block.end, end: piece.end }] : []),
    ]);
  }
  return pieces;
}

// What the viewer watches happen: pointer motion, clicks, keys, typing, scrolls, and an explicit
// focus's reading time.
function activity(timeline) {
  const busy = [...(timeline.scrolls ?? [])];
  const points = timeline.points ?? [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].x !== points[i - 1].x || points[i].y !== points[i - 1].y) busy.push({ start: points[i - 1].t, end: points[i].t });
  }
  for (const click of timeline.clicks ?? []) busy.push({ start: click.t - 0.2, end: (click.up ?? click.t) + 0.35 });
  for (const key of timeline.keys ?? []) busy.push({ start: key.t - 0.1, end: key.t + 0.3 });
  for (const focus of timeline.focuses ?? []) {
    if (focus.typingStart !== undefined) busy.push({ start: focus.typingStart - 0.1, end: (focus.interactionEnd ?? focus.end) + 0.1 });
    const shown = focus.readyAt ?? focus.t;
    if (focus.manual) busy.push({ start: shown, end: Math.min(focus.end, shown + focusReading) });
  }
  return busy;
}

// Stretches long enough to trim in which the viewer's input does nothing.
export function quietSpans(timeline) {
  return subtract({ start: 0, end: timeline.duration }, activity(timeline))
    .filter(span => span.end - span.start > staticThreshold);
}

// Stretches where nothing on screen changes: no pointer motion, click, key, typing or scroll, and no
// capture frame that looks different. Screencast frames only arrive when the page repaints; `still`
// holds the frames whose repaint is imperceptible (a blinking caret, a small spinner).
function staticSegments(timeline, still = new Set()) {
  const busy = activity(timeline);
  const frames = (timeline.frames ?? []).filter((frame, index) => index === 0 || !still.has(index));
  const segments = [];
  frames.forEach((frame, index) => {
    const span = { start: frame.t + 0.05, end: frames[index + 1]?.t ?? timeline.duration };
    for (const piece of subtract(span, busy)) {
      const length = piece.end - piece.start;
      if (length <= staticThreshold) continue;
      const duration = staticEdge * 2 + (length - staticEdge * 2) / staticSpeed;
      segments.push({ ...piece, duration, kind: 'static', edge: staticEdge });
    }
  });
  return segments;
}

function removeOverlaps(segments) {
  const accepted = [];
  for (const segment of segments.sort((a, b) => a.start - b.start)) {
    const previous = accepted.at(-1);
    if (!previous || segment.start >= previous.end) accepted.push(segment);
  }
  return accepted;
}

function findIdleSegments(timeline, still) {
  const segments = [];
  const steps = timeline.steps ?? [];

  for (const step of steps) {
    const target = timeline.focuses?.find(focus => focus.readyAt >= step.start && focus.readyAt <= step.actionStart);
    if (target) {
      const segment = makeIdleSegment(step.start, target.readyAt, 'prepare');
      if (segment) segments.push(segment);
    }
    if (step.action === 'wait') {
      const end = step.interactionEnd ?? step.end;
      const segment = makeIdleSegment(step.start, end, 'wait');
      if (segment) segments.push(segment);
    }

    if (step.expectationEnd !== undefined && step.interactionEnd !== undefined) {
      const segment = makeIdleSegment(step.interactionEnd, step.expectationEnd, 'expect');
      if (segment) segments.push(segment);
    }
  }

  if (!steps.some(step => step.expectationEnd !== undefined)) {
    for (const focus of timeline.focuses ?? []) {
      const segment = makeIdleSegment(focus.interactionEnd, focus.end, 'expect');
      if (segment) segments.push(segment);
    }
  }

  const protectedSpans = [...(timeline.scrolls ?? [])];
  for (let i = 1; i < (timeline.points?.length ?? 0); i++) {
    const a = timeline.points[i - 1];
    const b = timeline.points[i];
    if (a.x !== b.x || a.y !== b.y) protectedSpans.push({ start: a.t, end: b.t });
  }
  for (const click of timeline.clicks ?? []) protectedSpans.push({ start: click.t - 0.1, end: click.t + 0.2 });
  const idle = segments.filter(segment => !protectedSpans.some(span => span.start < segment.end && span.end > segment.start));
  return removeOverlaps([...idle, ...staticSegments(timeline, still)]);
}

// Spans captured in slow motion (scrolls, so the screencast keeps up) play back at real speed. The
// mapping is linear so the scroll keeps its own easing.
function slowMotionSegments(timeline) {
  return (timeline.slowMotion ?? []).map(({ start, end, factor }) => ({
    start, end, duration: (end - start) / factor, kind: 'slow-motion', linear: true,
  }));
}

// Integral of the minimum-jerk easing curve; speed and acceleration match at both seams.
function integratedEase(t) {
  return t ** 4 * (2.5 - 3 * t + t * t);
}

function mapMiddle(offset, sourceDuration, outputDuration) {
  const ramp = Math.min(0.45, outputDuration / 4);
  const rate = (outputDuration - ramp) / (sourceDuration - ramp);
  function entry(x) {
    return x - (1 - rate) * ramp * integratedEase(x / ramp);
  }
  if (offset < ramp) return entry(offset);
  if (offset > sourceDuration - ramp) return outputDuration - entry(sourceDuration - offset);
  return ramp * (1 + rate) / 2 + (offset - ramp) * rate;
}

function createTimeMap(segments) {
  return function mapTime(time) {
    let removed = 0;
    for (const segment of segments) {
      if (time >= segment.end) {
        removed += segment.end - segment.start - segment.duration;
        continue;
      }
      if (time <= segment.start) break;
      const sourceDuration = segment.end - segment.start;
      const offset = time - segment.start;
      const outputStart = segment.start - removed;
      if (segment.linear) return outputStart + offset * segment.duration / sourceDuration;
      const edge = segment.edge ?? preservedEdge;
      if (offset <= edge) return outputStart + offset;
      if (offset >= sourceDuration - edge) {
        return outputStart + segment.duration - (sourceDuration - offset);
      }
      const sourceMiddle = sourceDuration - edge * 2;
      const outputMiddle = segment.duration - edge * 2;
      return outputStart + edge + mapMiddle(offset - edge, sourceMiddle, outputMiddle);
    }
    return time - removed;
  };
}

function mapKeys(value, keys, mapTime) {
  for (const key of keys) {
    if (Number.isFinite(value[key])) value[key] = mapTime(value[key]);
  }
}

function remapTimeline(source, mapTime) {
  const timeline = structuredClone(source);
  for (const frame of timeline.frames ?? []) mapKeys(frame, ['t'], mapTime);
  for (const point of timeline.points ?? []) mapKeys(point, ['t'], mapTime);
  for (const click of timeline.clicks ?? []) mapKeys(click, ['t', 'up'], mapTime);
  for (const key of timeline.keys ?? []) mapKeys(key, ['t'], mapTime);
  for (const cursor of timeline.cursors ?? []) mapKeys(cursor, ['t'], mapTime);
  for (const scroll of timeline.scrolls ?? []) mapKeys(scroll, ['start', 'end'], mapTime);
  for (const focus of timeline.focuses ?? []) {
    mapKeys(focus, ['t', 'readyAt', 'approachStart', 'typingStart', 'interactionEnd', 'end'], mapTime);
    for (const caret of focus.carets ?? []) mapKeys(caret, ['t'], mapTime);
    if (focus.result) mapKeys(focus.result, ['t'], mapTime);
  }
  for (const step of timeline.steps ?? []) {
    mapKeys(step, ['start', 'actionStart', 'interactionEnd', 'expectationEnd', 'end'], mapTime);
  }
  timeline.duration = mapTime(timeline.duration);
  return timeline;
}

export function paceTimeline(source, mode = 'balanced', still) {
  const slowMotion = slowMotionSegments(source);
  const gaps = (mode === 'original' ? [] : findIdleSegments(source, still))
    .filter(gap => !slowMotion.some(span => span.start < gap.end && span.end > gap.start));
  const segments = [...gaps, ...slowMotion].sort((a, b) => a.start - b.start);
  const timeline = segments.length ? remapTimeline(source, createTimeMap(segments)) : source;
  const slowMotionSeconds = slowMotion.reduce((sum, span) => sum + span.end - span.start - span.duration, 0);
  return {
    timeline,
    report: {
      mode,
      adjustedGaps: gaps.length,
      savedSeconds: +(source.duration - timeline.duration - slowMotionSeconds).toFixed(3),
      slowMotionSeconds: +slowMotionSeconds.toFixed(3),
      sourceDuration: source.duration,
      contentDuration: timeline.duration,
      gaps: gaps.map(segment => ({
        kind: segment.kind,
        sourceSeconds: +(segment.end - segment.start).toFixed(3),
        outputSeconds: +segment.duration.toFixed(3),
      })),
    },
  };
}
