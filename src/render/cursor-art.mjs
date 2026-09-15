import { Path2D } from '@napi-rs/canvas';
import { ease } from '../motion.mjs';

const arrow = new Path2D('M0 0 L0 22 L5.6 16.8 L9.8 26 L14 24 L9.7 15 L17.5 15 Z');
const hand = new Path2D('M0 0 C0 -3 4 -3 4 0 L4 9 C4 6 8 6 8 9 C8 7 12 7 12 10 C12 8 16 9 16 12 L16 18 C16 23 13 26 8 26 L5 26 C2 26 0 24 -2 21 L-7 14 C-9 11 -5 9 -3 12 L0 15 Z');
const text = new Path2D('M-4 -10 Q0 -10 0 -7 L0 7 Q0 10 -4 10 M4 -10 Q0 -10 0 -7 M4 10 Q0 10 0 7');

function drawShape(context, type, opacity) {
  context.globalAlpha *= opacity;
  context.strokeStyle = '#ffffff';
  context.fillStyle = type === 'hand' ? '#ffffff' : '#17191f';
  context.lineJoin = 'round';
  context.lineCap = 'round';
  if (type === 'text') {
    context.lineWidth = 3;
    context.stroke(text);
    context.strokeStyle = '#17191f';
    context.lineWidth = 1.25;
    context.stroke(text);
  } else {
    const shape = type === 'hand' ? hand : arrow;
    context.lineWidth = 1.65;
    if (type === 'hand') context.strokeStyle = '#17191f';
    context.fill(shape);
    context.stroke(shape);
  }
}

export function drawCursor(context, point, cursor) {
  if (cursor.opacity <= 0) return;
  const { rotation, size, clickAge, opacity, type = 'arrow', previousType = type, blend = 1 } = cursor;
  context.save();
  context.translate(point.x, point.y);
  context.globalAlpha = opacity;
  let bounce = 1;
  if (clickAge >= 0 && clickAge < 0.3) {
    const compression = clickAge < 0.07 ? ease(clickAge / 0.07) : 1 - ease((clickAge - 0.07) / 0.23);
    bounce -= 0.08 * compression;
  }
  context.rotate(type === 'arrow' ? rotation : 0);
  context.scale(size * bounce, size * bounce);
  context.shadowColor = '#00000035';
  context.shadowBlur = 2;
  context.shadowOffsetY = 1;
  if (blend < 1) {
    context.save();
    drawShape(context, previousType, 1 - blend);
    context.restore();
  }
  drawShape(context, type, blend);
  context.restore();
}

export function drawClick(context, point, age, scale) {
  if (age < 0 || age >= 0.42) return;
  const progress = age / 0.42;
  context.save();
  context.strokeStyle = `rgba(255,255,255,${0.22 * (1 - progress)})`;
  context.lineWidth = 1.5 * scale;
  context.beginPath();
  context.arc(point.x, point.y, (7 + progress * 20) * scale, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
