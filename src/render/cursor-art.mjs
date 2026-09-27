import { Path2D } from '@napi-rs/canvas';

const arrow = new Path2D('M0 0 L0 22 L5.6 16.8 L9.8 26 L14 24 L9.7 15 L17.5 15 Z');
const hand = new Path2D('M0 0 C0 -3 4 -3 4 0 L4 9 C4 6 8 6 8 9 C8 7 12 7 12 10 C12 8 16 9 16 12 L16 18 C16 23 13 26 8 26 L5 26 C2 26 0 24 -2 21 L-7 14 C-9 11 -5 9 -3 12 L0 15 Z');
const text = new Path2D('M-4 -10 Q0 -10 0 -7 L0 7 Q0 10 -4 10 M4 -10 Q0 -10 0 -7 M4 10 Q0 10 0 7');
const ink = '#111318';

// The white outline or body casts the shadow; the dark ink on top is drawn without one.
function drawShape(context, type, { alpha, scale, rotation, pixels }) {
  if (alpha <= 0.002) return;
  context.save();
  context.globalAlpha *= alpha;
  if (type === 'arrow') context.rotate(rotation);
  context.scale(scale, scale);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  // Canvas shadows ignore the transform, so they are given in output pixels per cursor unit.
  const shadowUnit = pixels * scale;
  context.shadowColor = '#00000052';
  context.shadowBlur = 2.4 * shadowUnit;
  context.shadowOffsetY = 0.9 * shadowUnit;
  if (type === 'text') {
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3.2;
    context.stroke(text);
    context.shadowColor = 'transparent';
    context.strokeStyle = ink;
    context.lineWidth = 1.3;
    context.stroke(text);
  } else if (type === 'hand') {
    context.fillStyle = '#ffffff';
    context.fill(hand);
    context.shadowColor = 'transparent';
    context.strokeStyle = ink;
    context.lineWidth = 1.5;
    context.stroke(hand);
  } else {
    // The white border sits outside the black body, as in the system arrow.
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2.8;
    context.stroke(arrow);
    context.shadowColor = 'transparent';
    context.fillStyle = ink;
    context.fill(arrow);
  }
  context.restore();
}

export function drawCursor(context, point, cursor) {
  const { rotation, size, press, opacity, pixels, type = 'arrow', previousType = type, blend = 1 } = cursor;
  context.save();
  context.translate(point.x, point.y);
  context.globalAlpha = opacity;
  // Hiding shrinks the pointer as it fades, like Screen Studio's idle hide.
  const shrink = 0.6 + 0.4 * opacity;
  const scale = size * press * shrink;
  context.scale(scale, scale);
  const shadowPixels = pixels * press * shrink;
  if (blend < 1) drawShape(context, previousType, { alpha: 1 - blend, scale: 1 - 0.2 * blend, rotation, pixels: shadowPixels });
  drawShape(context, type, { alpha: blend, scale: 0.6 + 0.4 * blend, rotation, pixels: shadowPixels });
  context.restore();
}
