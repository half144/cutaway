import { clamp, framingMargin, safeZone } from '../motion.mjs';

// Zoom is for local detail: a close-up follows actions whose effect stays nearby (typing, a menu), holds
// briefly after the last one and joins actions that follow each other closely. An action whose effect
// fills the screen is shown from the overview. The camera moves with the hand: it sets off when the
// pointer starts toward its target, or just before a click when the pointer is already there.
const anticipation = 0.15;
const holds = { click: 1.8, type: 1.2, result: 1.4 };
const joinGap = 3;
const connectGap = 1.5;
const minShot = 1.2;
// Below this a close-up is no visible push-in; the overview reads better.
const minPushIn = 1.12;
const settleSeconds = 1.2;
// Between close-ups a few seconds apart on nearby subjects, the camera eases halfway out instead of
// returning to the overview and zooming straight back in.
const restGap = 2.5;
const closingHold = 0.4;

function fitZoom(region, scene) {
  return Math.min(scene.width * safeZone / (region.width + framingMargin.x * 2),
    scene.height * safeZone / (region.height + framingMargin.y * 2));
}

// The largest region that still fits at `zoom`.
function fittingSize(zoom, scene) {
  return {
    width: scene.width * safeZone / zoom - framingMargin.x * 2,
    height: scene.height * safeZone / zoom - framingMargin.y * 2,
  };
}

function union(regions) {
  const x = Math.min(...regions.map(region => region.x));
  const y = Math.min(...regions.map(region => region.y));
  return {
    x, y,
    width: Math.max(...regions.map(region => region.x + region.width)) - x,
    height: Math.max(...regions.map(region => region.y + region.height)) - y,
  };
}

function center(region) {
  return { x: region.x + region.width / 2, y: region.y + region.height / 2 };
}

function boxOf(value) {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

const moved = (from, to) => from.x !== to.x || from.y !== to.y;

// Share of `region` that `frame` shows.
function coverage(frame, region) {
  const width = Math.min(frame.x + frame.width, region.x + region.width) - Math.max(frame.x, region.x);
  const height = Math.min(frame.y + frame.height, region.y + region.height) - Math.max(frame.y, region.y);
  return width > 0 && height > 0 ? width * height / (region.width * region.height) : 0;
}

// Pointer moves are recorded as a stationary start sample followed by the path.
function movementStarts(points) {
  const starts = [];
  for (let i = 1; i < points.length; i++) {
    const continuing = i > 1 && moved(points[i - 2], points[i - 1]);
    if (moved(points[i - 1], points[i]) && !continuing) starts.push(points[i - 1].t);
  }
  return starts;
}

// When the pointer set off toward the place it reached at `arrival`; `arrival` if it did not move.
function movementStart(points, arrival) {
  let index = points.findLastIndex(point => point.t <= arrival + 1e-6);
  if (index < 1 || arrival - points[index].t > 0.25) return arrival;
  while (index > 0 && moved(points[index - 1], points[index])) index--;
  return points[index].t;
}

function manualScrolls(timeline) {
  if (timeline.scrolls?.length) return timeline.scrolls.filter(scroll => !scroll.automatic);
  return (timeline.steps ?? []).filter(step => step.action === 'scroll')
    .map(step => ({ start: step.start, end: step.interactionEnd ?? step.end }));
}

function anchorFor(focus, index, timeline, level, scene) {
  const nextAt = timeline.focuses[index + 1]?.t ?? Infinity;
  const click = timeline.clicks.find(candidate => candidate.t >= focus.t && candidate.t < nextAt);
  const box = boxOf(focus);
  let fallback;
  if (focus.action === 'type') {
    // Text starts at the leading edge of a wide field, so frame that part and follow the caret.
    const size = fittingSize(level, scene);
    fallback = { x: box.x, y: box.y, width: Math.min(box.width, size.width), height: Math.min(box.height, size.height) };
  } else {
    const point = click ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    fallback = { x: point.x - 180, y: point.y - 100, width: 360, height: 200 };
  }
  // Context may cost a little zoom, but never below a visible push-in (or below 1× at low levels).
  const minZoom = Math.max(level * 0.8, Math.min(level, minPushIn));
  const region = [focus.context, box].find(candidate => candidate && fitZoom(candidate, scene) >= minZoom) ?? fallback;
  const lastAction = focus.action === 'click' ? (click?.t ?? focus.t) : (focus.interactionEnd ?? focus.end);
  const resultZoom = focus.result ? fitZoom(focus.result, scene) : Infinity;
  return {
    arrival: focus.t,
    // A stroke made during the previous rest is this target's approach, even if the hand then waited.
    setOff: focus.approachStart ?? Math.min(movementStart(timeline.points ?? [], focus.t), focus.t - anticipation),
    ready: focus.readyAt ?? 0,
    region,
    field: box,
    followsCaret: focus.action === 'type' && region === fallback && fallback.width < box.width,
    carets: focus.carets ?? [],
    result: focus.result,
    zoom: Math.min(level, fitZoom(region, scene)),
    holdUntil: lastAction + (holds[focus.action] ?? holds.click),
    // A large result (new page, dialog) reads best from the overview; one that needs a wider frame
    // than the close-up gets its own shot. Either way, later actions start a new shot.
    revealsResult: resultZoom < Math.min(level, 1.25),
    endsShot: resultZoom < level * 0.95,
    // Zooming in on a control only to widen out as its large effect appears a moment later reads as fidgeting.
    overviewOnly: focus.action !== 'type' && resultZoom < Math.min(level, 1.25) && focus.result.t - lastAction < 1.5,
    lastAction,
  };
}

function caretTargets(anchor) {
  const { field, region } = anchor;
  return anchor.carets.map(caret => ({
    from: caret.t,
    region: {
      x: clamp(caret.x + 60 - region.width, field.x, field.x + field.width - region.width),
      y: clamp(caret.y + caret.height / 2 - region.height / 2, field.y, field.y + field.height - region.height),
      width: region.width,
      height: region.height,
    },
  }));
}

// Completes a shot from its anchors. Returns the connected shot that widens onto a result, if any.
function finishShot(shot, scene, scrolls, autoScrolls) {
  const { anchors } = shot;
  const [first] = anchors;
  const previousScroll = scrolls.findLast(scroll => scroll.end <= first.arrival);
  shot.startAt = Math.max(0, first.setOff, first.ready, previousScroll?.end ?? 0);
  shot.zoom = Math.min(...anchors.map(anchor => anchor.zoom));
  let releaseAt = Math.max(...anchors.map(anchor => anchor.holdUntil));
  const lastAction = Math.max(...anchors.map(anchor => anchor.lastAction));
  const autoScrolled = autoScrolls.some(scroll => scroll.start >= shot.startAt && scroll.start <= lastAction);

  const targets = [];
  let follower = null;
  for (const anchor of anchors) {
    targets.push({ from: Math.max(anchor.setOff, anchor.ready), region: anchor.region });
    if (anchor.followsCaret) targets.push(...caretTargets(anchor));
    const { result } = anchor;
    if (!result) continue;
    const combined = union([anchor.region, result]);
    const resultZoom = fitZoom(result, scene);
    const resultTarget = { from: result.t - 0.25, region: boxOf(result) };
    if (fitZoom(combined, scene) >= shot.zoom * 0.95) {
      targets.push({ from: result.t - 0.2, region: combined });
      releaseAt = Math.max(releaseAt, result.t + holds.result);
    } else if (resultZoom >= shot.zoom) {
      targets.push(resultTarget);
      releaseAt = Math.max(releaseAt, result.t + holds.result);
    } else if (!anchor.revealsResult) {
      // The actions keep their close-up; the camera then widens onto the result in a connected shot.
      releaseAt = Math.min(releaseAt, resultTarget.from);
      follower = { zoom: resultZoom, startAt: resultTarget.from, releaseAt: result.t + holds.result, targets: [resultTarget] };
    } else {
      releaseAt = Math.min(releaseAt, result.t + 0.3);
      shot.revealed = boxOf(result);
    }
  }
  const followsCaret = anchors.some(anchor => anchor.followsCaret);
  const whole = union(targets.map(target => target.region));
  shot.targets = !autoScrolled && !followsCaret && fitZoom(whole, scene) >= shot.zoom
    ? [{ from: shot.startAt, region: whole }]
    : targets.sort((a, b) => a.from - b.from);
  const nextScroll = scrolls.find(scroll => scroll.start > first.arrival);
  shot.cutoffAt = nextScroll ? Math.max(lastAction, nextScroll.start - (nextScroll.lead ?? 0.35)) : Infinity;
  shot.releaseAt = Math.min(releaseAt, shot.cutoffAt);
  if (follower) {
    follower.cutoffAt = shot.cutoffAt;
    follower.releaseAt = Math.min(follower.releaseAt, shot.cutoffAt);
  }
  return follower;
}

function manualShot(focus, level, scene, scrolls) {
  let region = boxOf(focus);
  const byWidth = scene.width * safeZone / (region.width + framingMargin.x * 2);
  if (fitZoom(region, scene) < 1.2 && byWidth >= 1.2) {
    // A tall region is read from the top: fit its width and frame its beginning.
    region = { ...region, height: fittingSize(Math.min(level, byWidth), scene).height };
  }
  const zoom = Math.min(level, fitZoom(region, scene));
  const previousScroll = scrolls.findLast(scroll => scroll.end <= focus.t);
  const nextScroll = scrolls.find(scroll => scroll.start > focus.t);
  const startAt = Math.max(focus.readyAt ?? focus.t, previousScroll?.end ?? 0);
  const cutoffAt = nextScroll ? Math.max(focus.end, nextScroll.start - 0.35) : Infinity;
  return {
    manual: true, zoom, startAt, cutoffAt,
    releaseAt: Math.min(focus.end + 0.9, cutoffAt),
    targets: [{ from: startAt, region }],
  };
}

export function planShots(timeline, { scene, level }) {
  const report = { skippedFocuses: 0, droppedShots: 0 };
  if (level <= 1) return { shots: [], report };
  // A focus too large to zoom asks for the overview: close-ups end before it and resume after it.
  const overviews = timeline.focuses.filter(focus => focus.manual && manualShot(focus, level, scene, []).zoom < minPushIn)
    .map(focus => ({ start: focus.readyAt ?? focus.t, end: focus.end }));
  const scrolls = [...manualScrolls(timeline), ...overviews].sort((a, b) => a.start - b.start);
  const autoScrolls = (timeline.scrolls ?? []).filter(scroll => scroll.automatic);
  const shots = [];
  let open = null;
  let overviewHold = null;
  for (const [index, focus] of timeline.focuses.entries()) {
    if (focus.manual) {
      open = null;
      const shot = manualShot(focus, level, scene, scrolls);
      if (shot.zoom < minPushIn) report.skippedFocuses++;
      else shots.push(shot);
      continue;
    }
    const anchor = anchorFor(focus, index, timeline, level, scene);
    // The overview lasts until the hand sets off again, so the next close-up leaves with it.
    if (overviewHold) overviewHold.end = Math.min(overviewHold.end, anchor.setOff);
    overviewHold = null;
    const previous = open?.anchors.at(-1);
    const scrolledAway = previous && scrolls.some(scroll => scroll.start > previous.lastAction && scroll.start < anchor.arrival);
    const joinable = previous && !scrolledAway && !previous.endsShot && !previous.revealsResult
      && anchor.arrival - previous.lastAction <= joinGap;
    const nearby = previous && Math.hypot(center(anchor.region).x - center(previous.region).x,
      center(anchor.region).y - center(previous.region).y) < scene.width / level * 0.35;
    if (joinable && (!anchor.overviewOnly || nearby)) {
      // Already close by: finish the action in the close-up, then widen onto its effect.
      open.anchors.push(anchor);
    } else if (anchor.overviewOnly) {
      open = null;
      // Zoom out as the hand sets off, and let the effect play out on the overview.
      overviewHold = { start: anchor.setOff, end: anchor.result.t + 0.6, lead: 0 };
      scrolls.push(overviewHold);
      scrolls.sort((a, b) => a.start - b.start);
    } else {
      open = { anchors: [anchor] };
      shots.push(open);
    }
  }
  for (const shot of shots.filter(shot => shot.anchors)) {
    const follower = finishShot(shot, scene, scrolls, autoScrolls);
    if (follower) shots.push(follower);
    delete shot.anchors;
  }

  shots.sort((a, b) => a.startAt - b.startAt);
  const departures = movementStarts(timeline.points ?? []);
  // The video opens on the whole page: a focus before the first gesture would zoom in from nowhere.
  if (shots[0]?.manual && departures.length && shots[0].startAt < departures[0]) {
    shots.shift();
    report.skippedFocuses++;
  }
  const kept = [];
  for (const [index, shot] of shots.entries()) {
    const next = shots[index + 1];
    // When the hand leaves soon after a close-up would end, zoom out with it instead of just before it.
    const departure = departures.find(start => start >= shot.releaseAt - 0.1 && start <= shot.releaseAt + 1);
    if (departure !== undefined && departure <= shot.cutoffAt) shot.releaseAt = Math.max(shot.releaseAt, departure);
    const scrollBetween = next && scrolls.some(scroll => scroll.start >= shot.releaseAt - 0.4 && scroll.start < next.startAt);
    if (next && !scrollBetween && shot.revealed && next.startAt - shot.releaseAt <= joinGap
      && coverage(next.targets[0].region, shot.revealed) >= 0.5) {
      // The next shot frames the result just revealed: go straight to it, not out to the overview and back.
      next.startAt = next.targets[0].from = shot.releaseAt;
      shot.connected = true;
    }
    // Connected shots pan from one subject to the next instead of zooming out and straight back in.
    // After a reveal the overview needs a moment to register; with less than a second, it would only pump.
    const gap = next ? next.startAt - shot.releaseAt : Infinity;
    if (next && !scrollBetween && (shot.revealed ? gap < 1 : gap <= connectGap)) {
      shot.releaseAt = next.startAt;
      shot.connected = true;
    }
    let rest = null;
    if (next && !scrollBetween && !shot.revealed && !shot.connected && next.startAt - shot.releaseAt <= restGap) {
      const [from, to] = [shot.targets.at(-1).region, next.targets[0].region];
      const view = scene.width / Math.min(shot.zoom, next.zoom);
      if (Math.hypot(center(from).x - center(to).x, center(from).y - center(to).y) < view * 0.6) {
        rest = { zoom: 1 + (Math.min(shot.zoom, next.zoom) - 1) * 0.5, startAt: shot.releaseAt, releaseAt: next.startAt,
          targets: [{ from: shot.releaseAt, region: union([from, to]) }], connected: true };
        shot.connected = true;
      }
    }
    if (!shot.connected && shot.releaseAt - shot.startAt < minShot) {
      shot.releaseAt = Math.min(shot.startAt + minShot, shot.cutoffAt, next?.startAt ?? Infinity);
    }
    if (shot.releaseAt - shot.startAt < minShot * 0.75 || shot.zoom < 1.05) {
      report.droppedShots++;
      // The close-up handing over to a shot too brief to keep holds on in its place, rather than
      // leaving a gap that pumps out to the overview and straight back in.
      const previous = kept.at(-1);
      if (previous?.connected && previous.releaseAt === shot.startAt && shot.zoom >= 1.05) previous.releaseAt = shot.releaseAt;
      continue;
    }
    shot.id = kept.length;
    kept.push(shot);
    if (rest) {
      rest.id = kept.length;
      kept.push(rest);
    }
  }
  return { shots: kept, report };
}

export function shotTarget(shot, time) {
  return shot.targets.findLast(target => target.from <= time) ?? shot.targets[0];
}

export function exportDuration(timeline, shots) {
  const last = shots.at(-1);
  if (!last) return timeline.duration;
  // The final zoom-out settles to under half a pixel in ~1.5 s; the video then rests a calm second on
  // the overview. Extra output holds the last captured page frame.
  return Math.max(timeline.duration, Math.min(last.releaseAt, timeline.duration) + settleSeconds + closingHold);
}
