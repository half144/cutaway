import { clamp } from '../motion.mjs';

const symbols = {
  Meta: '⌘', ControlOrMeta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧',
  Enter: '↵', Escape: 'esc', Tab: '⇥', Backspace: '⌫', Delete: '⌦', Space: 'Space', ' ': 'Space',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
const modifiers = new Set(['Meta', 'ControlOrMeta', 'Control', 'Alt', 'Shift']);
const font = '"Helvetica Neue", "Apple Symbols", Helvetica, Arial, sans-serif';
const enter = 0.25;
const linger = 1.1;
const exit = 0.3;

// Splits like Playwright: a `+` with nothing before it is the key itself (`Control++`).
function keyParts(key) {
  const parts = [];
  let token = '';
  for (const character of key) {
    if (character === '+' && token) {
      parts.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (token) parts.push(token);
  return parts;
}

// Named keys that change the page on their own (Escape clears a field, Enter submits) are shown so the
// change has a visible cause; typed text never reaches this overlay.
const namedKeys = new Set(['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Like Screen Studio, plain character keys stay hidden by default; shortcuts and named keys show.
export function keyEvents(timeline, mode) {
  if (mode === 'none') return [];
  return (timeline.keys ?? [])
    .filter(event => mode === 'all' || keyParts(event.key).some(part => modifiers.has(part) || namedKeys.has(part)))
    .map(event => ({
      t: event.t,
      labels: keyParts(event.key).map(part => symbols[part] ?? (part.length === 1 ? part.toUpperCase() : part)),
    }));
}

export function drawKeys(context, events, time, width, height) {
  const event = events.findLast(candidate => candidate.t <= time);
  if (!event) return;
  const next = events.find(candidate => candidate.t > event.t);
  const end = Math.min(event.t + linger + enter, next?.t ?? Infinity);
  const shown = clamp((time - event.t) / enter, 0, 1);
  const leaving = clamp((time - end) / exit, 0, 1);
  const presence = (1 - (1 - shown) ** 3) * (1 - leaving * leaving);
  if (presence <= 0.002) return;

  const unit = height / 1080;
  const size = 30 * unit;
  const capHeight = size * 1.35;
  context.save();
  context.font = `500 ${size}px ${font}`;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  const caps = event.labels.map(label => Math.max(capHeight, context.measureText(label).width + size * 0.7));
  const gap = size * 0.28;
  const pad = size * 0.38;
  const pillWidth = caps.reduce((sum, cap) => sum + cap, 0) + gap * (caps.length - 1) + pad * 2;
  const pillHeight = capHeight + pad * 2;
  const x = (width - pillWidth) / 2;
  const y = height * 0.9 - pillHeight + (1 - presence) * 10 * unit;
  const scale = 0.94 + 0.06 * presence;

  context.globalAlpha = presence;
  context.translate(width / 2, y + pillHeight / 2);
  context.scale(scale, scale);
  context.translate(-width / 2, -(y + pillHeight / 2));
  context.shadowColor = '#00000059';
  context.shadowBlur = 28 * unit;
  context.shadowOffsetY = 8 * unit;
  context.fillStyle = '#16161af0';
  context.beginPath();
  context.roundRect(x, y, pillWidth, pillHeight, pillHeight * 0.32);
  context.fill();
  context.shadowColor = 'transparent';

  let capX = x + pad;
  for (const [index, label] of event.labels.entries()) {
    context.fillStyle = '#ffffff17';
    context.beginPath();
    context.roundRect(capX, y + pad, caps[index], capHeight, size * 0.3);
    context.fill();
    context.fillStyle = '#ffffff';
    context.fillText(label, capX + caps[index] / 2, y + pad + size * 0.7);
    capX += caps[index] + gap;
  }
  context.restore();
}
