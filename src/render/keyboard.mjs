import { clamp, easeOut } from '../motion.mjs';
import { uiFont } from './toolbar.mjs';
// An iOS 26 keyboard without the suggestion bar, in points: a light panel with rounded top corners and
// white keys, special keys included, then the strip with the globe above the home indicator. Four rows
// of 42 pt keys, 54 pt apart.
const height = 291;
const rowPitch = 54;
const keyHeight = 42;
const keyRadius = 8.5;
const panelRadius = 26;
const side = 3;
const gap = 6;
const openSeconds = 0.32;
const closeSeconds = 0.25;
// A key shows pressed this long, or until the next key.
const pressSeconds = 0.1;

const themes = {
  light: { base: '#d5d8dd', key: '#ffffff', pressed: '#aeb3bc', ink: '#1c1c1e' },
  dark: { base: '#252527', key: '#5c5c60', pressed: '#3c3c3f', ink: '#ffffff' },
};

// The keyboard is on screen only while text is typed: it rises as the field is tapped, stays for a
// return key pressed right after, and is gone before the next finger lands, so it never hides a tap.
// A field it would cover is lifted above it, as iOS does. Typing on into another field keeps it up,
// provided that field was tapped where the raised page showed it; the page then moves to that field's lift.
export function keyboardSpans(timeline) {
  const { viewport, device } = timeline;
  const top = viewport.height + device.insets.bottom - height;
  const touches = timeline.touches ?? [];
  const spans = [];
  for (const focus of timeline.focuses) {
    if (!focus.keys?.length) continue;
    const typingStart = focus.typingStart ?? focus.keys[0].t;
    const tap = touches.find(touch => touch.t >= focus.t - 0.05 && touch.t <= typingStart);
    const lastKey = focus.keys.at(-1).t;
    const enter = (timeline.keys ?? []).find(key => key.key === 'Enter' && key.t > lastKey && key.t < lastKey + 1.5);
    const keys = [...focus.keys, ...(enter ? [{ t: enter.t, key: '\n' }] : [])];
    const next = touches.find(touch => touch.t > keys.at(-1).t);
    const close = Math.max(keys.at(-1).t + 0.15, Math.min(keys.at(-1).t + (enter ? 0.25 : 0.45), (next?.t ?? Infinity) - closeSeconds - 0.05));
    const open = Math.min(tap?.up ?? Infinity, typingStart - openSeconds);
    const lift = { t: open, lift: clamp(focus.y + focus.height + 10 - top, 0, Math.max(0, focus.y - 12)), focus };
    const previous = spans.at(-1);
    const hidden = previous && tap && tap.points[0].y - previous.lifts.at(-1).lift >= top;
    if (previous && open - previous.close < 0.6 && previous.layout === (focus.keyboard ?? 'text') && !hidden) {
      previous.close = close;
      previous.keys.push(...keys);
      previous.lifts.push(lift);
    } else {
      spans.push({ open, close, layout: focus.keyboard ?? 'text', lifts: [lift], keys });
    }
  }
  return spans;
}

// How far the page is raised: each field's lift, eased in as its keyboard or tap arrives.
function liftAt(span, time) {
  let lift = 0;
  for (const [index, step] of span.lifts.entries()) {
    if (step.t > time) break;
    const from = index ? span.lifts[index - 1].lift : 0;
    lift = from + (step.lift - from) * easeOut(clamp((time - step.t) / openSeconds, 0, 1));
  }
  return lift;
}

// Typing seen as it happens on a phone: the field (lifted if needed) together with the keyboard.
export function keyboardFocuses(timeline, spans) {
  const bottom = timeline.viewport.height + timeline.device.insets.bottom;
  const lifts = new Map(spans.flatMap(span => span.lifts.map(step => [step.focus, step.lift])));
  return timeline.focuses.map(focus => {
    if (!lifts.has(focus)) return focus;
    const y = focus.y - lifts.get(focus);
    return { ...focus, y, context: { x: 0, y, width: timeline.viewport.width, height: bottom - y } };
  });
}

// A finger lands where the page showed at that moment: touches made while the page is raised move with it.
export function liftedTouches(touches, spans) {
  return touches.map(touch => {
    const lift = keyboardAt(spans, touch.t)?.lift ?? 0;
    return lift ? { ...touch, points: touch.points.map(point => ({ ...point, y: point.y - lift })) } : touch;
  });
}

const easeIn = t => t * t * t;

export function keyboardAt(spans, time) {
  const span = spans.find(candidate => time >= candidate.open && time < candidate.close + closeSeconds);
  if (!span) return null;
  const closing = time >= span.close;
  const shown = closing
    ? 1 - easeIn(clamp((time - span.close) / closeSeconds, 0, 1))
    : easeOut(clamp((time - span.open) / openSeconds, 0, 1));
  const index = span.keys.findLastIndex(key => key.t <= time);
  const key = span.keys[index];
  const pressed = key && time - key.t < Math.min(pressSeconds, (span.keys[index + 1]?.t ?? Infinity) - key.t) ? key.key : null;
  return { shown: +shown.toFixed(4), lift: +(liftAt(span, time) * (closing ? shown : 1)).toFixed(3), layout: span.layout, pressed };
}

function letterRows(width) {
  const keyWidth = (width - side * 2 - gap * 9) / 10;
  const pitch = keyWidth + gap;
  const row = (letters, x, y) => [...letters].map((letter, index) => ({ id: letter, label: letter, x: x + index * pitch, y, width: keyWidth }));
  const specialWidth = keyWidth * 1.3;
  const small = keyWidth * 1.25;
  const returnWidth = keyWidth * 2.6;
  const bottom = rowPitch * 3;
  return [
    ...row('qwertyuiop', side, 0),
    ...row('asdfghjkl', side + pitch / 2, rowPitch),
    { id: 'shift', x: side, y: rowPitch * 2, width: specialWidth, special: true },
    ...row('zxcvbnm', (width - 7 * keyWidth - 6 * gap) / 2, rowPitch * 2),
    { id: 'delete', x: width - side - specialWidth, y: rowPitch * 2, width: specialWidth, special: true },
    { id: 'numbers', label: '123', x: side, y: bottom, width: small, special: true, small: true },
    { id: 'emoji', x: side + small + gap, y: bottom, width: small, special: true },
    { id: ' ', x: side + small * 2 + gap * 2, y: bottom, width: width - side * 2 - small * 2 - returnWidth - gap * 3 },
    { id: '\n', glyph: 'return', x: width - side - returnWidth, y: bottom, width: returnWidth, special: true },
  ];
}

function numberPad(width) {
  const keyWidth = (width - gap * 4) / 3;
  const letters = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
  const keys = letters.map((sub, index) => ({
    id: String(index + 1), label: String(index + 1), sub,
    x: gap + index % 3 * (keyWidth + gap), y: Math.floor(index / 3) * rowPitch, width: keyWidth,
  }));
  keys.push({ id: '0', label: '0', x: gap * 2 + keyWidth, y: rowPitch * 3, width: keyWidth });
  keys.push({ id: 'delete', x: gap * 3 + keyWidth * 2, y: rowPitch * 3, width: keyWidth, special: true, bare: true });
  return keys;
}

// The key a typed character presses: accents land on their base letter, as on a keyboard without
// long-press accent menus.
function keyFor(character, keys) {
  if (!character) return null;
  const base = character === ' ' || character === '\n' ? character : character.normalize('NFD')[0].toLowerCase();
  return keys.find(key => key.id === base) ?? null;
}

function drawGlyph(context, id, x, y, unit) {
  context.lineWidth = 1.6 * unit;
  context.lineJoin = 'round';
  context.beginPath();
  if (id === 'shift') {
    context.moveTo(x, y - 8 * unit);
    context.lineTo(x + 8 * unit, y + 0.5 * unit);
    context.lineTo(x + 3.8 * unit, y + 0.5 * unit);
    context.lineTo(x + 3.8 * unit, y + 7 * unit);
    context.lineTo(x - 3.8 * unit, y + 7 * unit);
    context.lineTo(x - 3.8 * unit, y + 0.5 * unit);
    context.lineTo(x - 8 * unit, y + 0.5 * unit);
    context.closePath();
    context.stroke();
  } else if (id === 'delete') {
    context.moveTo(x - 11 * unit, y);
    context.lineTo(x - 5 * unit, y - 7 * unit);
    context.lineTo(x + 11 * unit, y - 7 * unit);
    context.lineTo(x + 11 * unit, y + 7 * unit);
    context.lineTo(x - 5 * unit, y + 7 * unit);
    context.closePath();
    context.moveTo(x - 1 * unit, y - 3.5 * unit);
    context.lineTo(x + 6 * unit, y + 3.5 * unit);
    context.moveTo(x + 6 * unit, y - 3.5 * unit);
    context.lineTo(x - 1 * unit, y + 3.5 * unit);
    context.stroke();
  } else if (id === 'globe') {
    context.arc(x, y, 10 * unit, 0, Math.PI * 2);
    context.moveTo(x - 10 * unit, y);
    context.lineTo(x + 10 * unit, y);
    context.moveTo(x, y - 10 * unit);
    context.lineTo(x, y + 10 * unit);
    context.ellipse(x, y, 4.5 * unit, 10 * unit, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (id === 'return') {
    context.moveTo(x + 7 * unit, y - 6 * unit);
    context.lineTo(x + 7 * unit, y + 1.5 * unit);
    context.lineTo(x - 7 * unit, y + 1.5 * unit);
    context.moveTo(x - 3 * unit, y - 2.5 * unit);
    context.lineTo(x - 7 * unit, y + 1.5 * unit);
    context.lineTo(x - 3 * unit, y + 5.5 * unit);
    context.stroke();
  } else if (id === 'emoji') {
    context.arc(x, y, 9.5 * unit, 0, Math.PI * 2);
    context.moveTo(x + 5 * unit, y + 1.5 * unit);
    context.arc(x, y + 1.5 * unit, 5 * unit, 0, Math.PI);
    context.stroke();
    for (const eye of [-3.3, 3.3]) {
      context.beginPath();
      context.arc(x + eye * unit, y - 3 * unit, 1.2 * unit, 0, Math.PI * 2);
      context.fill();
    }
  }
}

// The enlarged key iOS shows above a pressed letter: a bubble joined to the key by a neck.
function drawCallout(context, key, character, width, unit, theme, origin) {
  const bubble = { width: key.width + 20, height: 50 };
  bubble.x = clamp(key.x - 10, 1, width - 1 - bubble.width);
  bubble.y = key.y - bubble.height - 4;
  const at = value => ({ x: origin.x + value.x * unit, y: origin.y + value.y * unit });
  const b = at(bubble);
  const k = at(key);
  context.save();
  context.shadowColor = '#00000059';
  context.shadowBlur = 6 * unit;
  context.shadowOffsetY = 1.5 * unit;
  context.fillStyle = theme.key;
  context.beginPath();
  // All three parts wind clockwise, so their overlaps fill instead of cancelling out.
  const left = b.x + 1 * unit;
  const right = b.x + (bubble.width - 1) * unit;
  const neckTop = b.y + (bubble.height - 6) * unit;
  context.roundRect(b.x, b.y, bubble.width * unit, bubble.height * unit, 12 * unit);
  context.moveTo(left, neckTop);
  context.lineTo(right, neckTop);
  context.bezierCurveTo(right, neckTop + 12 * unit, k.x + key.width * unit, k.y - 2 * unit, k.x + key.width * unit, k.y + 4 * unit);
  context.lineTo(k.x, k.y + 4 * unit);
  context.bezierCurveTo(k.x, k.y - 2 * unit, left, neckTop + 12 * unit, left, neckTop);
  context.closePath();
  context.roundRect(k.x, k.y, key.width * unit, keyHeight * unit, keyRadius * unit);
  context.fill();
  context.restore();
  context.fillStyle = theme.ink;
  context.font = `${34 * unit}px ${uiFont}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(character, b.x + bubble.width / 2 * unit, b.y + bubble.height / 2 * unit);
}

// `screen` is in output pixels, `unit` output pixels per point.
export function drawKeyboard(context, screen, unit, state, dark) {
  const theme = themes[dark ? 'dark' : 'light'];
  const width = screen.width / unit;
  const top = screen.y + screen.height - height * unit * state.shown;
  context.save();
  context.fillStyle = theme.base;
  context.beginPath();
  context.roundRect(screen.x, top, screen.width, height * unit, [panelRadius * unit, panelRadius * unit, 0, 0]);
  context.fill();
  const keys = state.layout === 'numeric' ? numberPad(width) : letterRows(width);
  const origin = { x: screen.x, y: top + 8 * unit };
  const pressed = keyFor(state.pressed, keys);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const key of keys) {
    const x = origin.x + key.x * unit;
    const y = origin.y + key.y * unit;
    // Letters pop up above the key instead; other keys darken while pressed.
    const down = key === pressed && (key.special || key.id === ' ' || state.layout === 'numeric');
    if (!key.bare) {
      context.fillStyle = down ? theme.pressed : theme.key;
      context.beginPath();
      context.roundRect(x, y, key.width * unit, keyHeight * unit, keyRadius * unit);
      context.fill();
    }
    context.fillStyle = theme.ink;
    context.strokeStyle = theme.ink;
    const middle = { x: x + key.width / 2 * unit, y: y + keyHeight / 2 * unit };
    if (key.label === undefined) {
      drawGlyph(context, key.glyph ?? key.id, middle.x, middle.y, unit);
    } else if (key.sub !== undefined) {
      context.font = `${25 * unit}px ${uiFont}`;
      context.fillText(key.label, middle.x, middle.y - (key.sub ? 4 : 0) * unit);
      context.font = `600 ${9.5 * unit}px ${uiFont}`;
      context.fillText(key.sub, middle.x, middle.y + 12 * unit);
    } else {
      context.font = `${(key.small ? 16 : 22.5) * unit}px ${uiFont}`;
      context.fillText(key.label, middle.x, middle.y - (key.small ? 0 : 1) * unit);
    }
  }
  if (state.layout !== 'numeric') {
    drawGlyph(context, 'globe', screen.x + 29 * unit, origin.y + (rowPitch * 4 + 16) * unit, unit);
    if (pressed && !pressed.special && pressed.id !== ' ') {
      drawCallout(context, pressed, state.pressed, width, unit, theme, origin);
    }
  }
  context.restore();
}
