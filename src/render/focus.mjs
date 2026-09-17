import { focusZoom } from '../motion.mjs';

// A network wait is not a user interaction. Manual focus explicitly holds the camera.
export function focusWindows(timeline, idleSeconds = 2.4) {
  const scrolls = timeline.scrolls?.length ? timeline.scrolls
    : (timeline.steps ?? []).filter(step => step.action === 'scroll').map(step => ({ start: step.start, end: step.interactionEnd ?? step.end }));
  let clickIndex = 0;
  const windows = timeline.focuses.map((focus, index) => {
    while (clickIndex < timeline.clicks.length && timeline.clicks[clickIndex].t < focus.t) clickIndex++;
    const click = timeline.clicks[clickIndex];
    const next = timeline.focuses[index + 1]?.t ?? Infinity;
    let lastInteraction = focus.manual ? focus.end : (focus.interactionEnd ?? focus.end);
    if (focus.action === 'click') {
      lastInteraction = click && click.t < next ? click.t : focus.t;
    }
    const previous = timeline.focuses[index - 1];
    const protectedUntil = previous?.manual || previous?.action === 'type'
      ? (previous.interactionEnd ?? previous.end) : 0;
    const precedingScroll = scrolls.findLast(scroll => scroll.end <= focus.t);
    const followingScroll = scrolls.find(scroll => scroll.start > focus.t);
    const startAt = Math.max(0, focus.t - 0.55, focus.readyAt ?? 0, protectedUntil, precedingScroll?.end ?? 0);
    const cutoffAt = followingScroll ? Math.max(lastInteraction, followingScroll.start - 0.35) : Infinity;
    const releaseAt = Math.min(cutoffAt, lastInteraction + (focus.manual ? 2 : idleSeconds));
    return { ...focus, startAt, releaseAt, cutoffAt };
  });
  // Bridge brief gaps rather than starting a zoom-out immediately before the next focus.
  for (let i = 0; i + 1 < windows.length; i++) {
    const current = windows[i];
    const next = windows[i + 1];
    if (next.startAt - current.releaseAt <= 1 && next.t < current.cutoffAt) {
      current.releaseAt = Math.max(current.releaseAt, next.t);
    }
  }
  return windows;
}

export function planFocusZooms(windows, viewport, maxZoom) {
  for (const focus of windows) {
    focus.plannedZoom = focusZoom(focus, viewport.width, viewport.height, maxZoom, 0.65);
  }
  let group = [];
  let groupZoom = Infinity;
  function finishGroup() {
    for (const focus of group) focus.plannedZoom = groupZoom;
    if (group.length < 2) return;
    const regions = group.map(focus => focus.context ?? focus);
    const x = Math.min(...regions.map(region => Math.max(0, region.x)));
    const y = Math.min(...regions.map(region => Math.max(0, region.y)));
    const right = Math.max(...regions.map(region => Math.min(viewport.width, region.x + region.width)));
    const bottom = Math.max(...regions.map(region => Math.min(viewport.height, region.y + region.height)));
    const region = { x, y, width: right - x, height: bottom - y };
    if ((region.width + 100) * groupZoom <= viewport.width * 0.65
      && (region.height + 90) * groupZoom <= viewport.height * 0.65) {
      for (const focus of group) focus.framingContext = region;
    }
  }
  for (const focus of windows) {
    const previous = group.at(-1);
    const distance = previous ? Math.hypot(
      previous.x + previous.width / 2 - focus.x - focus.width / 2,
      previous.y + previous.height / 2 - focus.y - focus.height / 2,
    ) : Infinity;
    if (!previous || focus.t > previous.releaseAt || distance >= viewport.width * 0.25
      || Math.abs(groupZoom - focus.plannedZoom) > 0.3) {
      finishGroup();
      group = [];
      groupZoom = Infinity;
    }
    group.push(focus);
    groupZoom = Math.min(groupZoom, focus.plannedZoom);
  }
  finishGroup();
  return windows;
}

export function renewFocus(focus, time, speed) {
  // Movement may sustain an active close-up, but must never resurrect a stale target.
  if (focus && !focus.manual && time >= focus.t && time <= focus.releaseAt && speed > 7.2) {
    focus.releaseAt = Math.min(focus.cutoffAt ?? Infinity, Math.max(focus.releaseAt, time + 2.4));
  }
}

export function exportDuration(timeline, focuses, maxZoom) {
  const last = focuses.at(-1);
  if (!last || maxZoom === 1 || last.plannedZoom <= 1) return timeline.duration;
  // Give the final zoom-out time to settle; extra output holds the last captured page frame.
  return Math.max(timeline.duration, last.releaseAt + 1.5);
}
