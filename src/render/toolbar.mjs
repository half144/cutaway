import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// Measured in page pixels, like the captured viewport.
export const toolbarHeight = 40;
export const uiFont = '"Helvetica Neue", Helvetica, Arial, sans-serif';

// Toolbar tone follows the top of the page so the window reads as one piece.
export async function toolbarStyle(page, address) {
  const first = await loadImage(await readFile(page));
  const probe = createCanvas(16, 1);
  const context = probe.getContext('2d');
  context.drawImage(first, 0, 0, first.width, Math.max(1, first.height / 100), 0, 0, 16, 1);
  const pixels = context.getImageData(0, 0, 16, 1).data;
  let luminance = 0;
  for (let i = 0; i < pixels.length; i += 4) luminance += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255 / 16;
  const url = address ? new URL(address) : null;
  return {
    dark: luminance < 0.4,
    host: url && (url.protocol === 'file:' ? basename(url.pathname) : url.host.replace(/^www\./, '')),
    secure: url?.protocol === 'https:',
  };
}

export function drawToolbar(context, frame, toolbar) {
  const { dark, host, secure } = toolbar;
  const unit = frame.toolbar / toolbarHeight;
  const top = frame.y - frame.toolbar;
  context.save();
  context.beginPath();
  context.roundRect(frame.x, top, frame.width, frame.toolbar, [frame.radius, frame.radius, 0, 0]);
  context.fillStyle = dark ? '#2b2b30' : '#f4f4f6';
  context.fill();
  context.fillStyle = dark ? '#ffffff14' : '#0000001a';
  context.fillRect(frame.x, frame.y - unit, frame.width, unit);

  const colors = ['#ff5f57', '#febc2e', '#28c840'];
  colors.forEach((color, index) => {
    context.beginPath();
    context.arc(frame.x + (20 + index * 20) * unit, top + frame.toolbar / 2, 6 * unit, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 0.6 * unit;
    context.strokeStyle = '#0000001f';
    context.stroke();
  });

  if (host) {
    const fieldWidth = Math.min(frame.width * 0.46, 560 * unit);
    const fieldHeight = 26 * unit;
    const fieldX = frame.x + (frame.width - fieldWidth) / 2;
    const fieldY = top + (frame.toolbar - fieldHeight) / 2;
    context.beginPath();
    context.roundRect(fieldX, fieldY, fieldWidth, fieldHeight, 7 * unit);
    context.fillStyle = dark ? '#3a3a40' : '#e4e4e8';
    context.fill();
    context.font = `${12.5 * unit}px ${uiFont}`;
    context.textBaseline = 'middle';
    const textWidth = context.measureText(host).width;
    const lockWidth = secure ? 13 * unit : 0;
    let x = frame.x + frame.width / 2 - (textWidth + lockWidth) / 2;
    const y = fieldY + fieldHeight / 2;
    const ink = dark ? '#d8d8de' : '#48484f';
    context.fillStyle = ink;
    if (secure) {
      context.strokeStyle = ink;
      context.lineWidth = 1.2 * unit;
      context.beginPath();
      context.arc(x + 4 * unit, y - 1.5 * unit, 2.6 * unit, Math.PI, 0);
      context.stroke();
      context.beginPath();
      context.roundRect(x, y - 1.5 * unit, 8 * unit, 6 * unit, 1.2 * unit);
      context.fill();
      x += lockWidth;
    }
    context.fillText(host, x, y);
  }
  context.restore();
}
