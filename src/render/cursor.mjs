import { clamp } from '../motion.mjs';

export function cursorEvents(timeline) {
  return (timeline.cursors ?? []).filter((event, index, events) => !events[index + 1] || events[index + 1].t - event.t >= 0.08);
}

export function cursorAppearance(events, time, index = 0) {
  while (index + 1 < events.length && events[index + 1].t <= time) index++;
  const event = events[index];
  if (!event || event.t > time) return { index, type: 'arrow', blend: 1 };
  return { index, type: event.type, previousType: events[index - 1]?.type ?? 'arrow', blend: clamp((time - event.t) / 0.08, 0, 1) };
}

export class CursorVisibility {
  constructor() {
    this.opacity = 1;
    this.lastActivity = 0;
  }

  update(time, active, dt) {
    if (active) this.lastActivity = time;
    const target = 1 - clamp((time - this.lastActivity - 2) / 0.4, 0, 1);
    // Smooth both directions, including the first movement after a long idle period.
    this.opacity += (target - this.opacity) * (1 - Math.exp(-18 * dt));
    return this.opacity;
  }
}
