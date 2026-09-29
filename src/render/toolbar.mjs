import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// Safari 26 on macOS Tahoe, measured on a Retina screenshot of a 1444 pt window. Points, like the
// captured viewport's page pixels.
export const toolbarHeight = 52;
export const uiFont = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const systemFont = `"System Font", ${uiFont}`;
const middle = 25.75;
const lights = ['#ff5c60', '#fac800', '#35c759'];

// Safari tints its toolbar with the top of the page, so the window reads as one piece.
export async function toolbarStyle(page, address) {
  const first = await loadImage(await readFile(page));
  const probe = createCanvas(64, 1);
  const context = probe.getContext('2d');
  context.drawImage(first, 0, 0, first.width, 1, 0, 0, 64, 1);
  const pixels = context.getImageData(0, 0, 64, 1).data;
  // The median ignores a sliver of something else along the edge.
  const [r, g, b] = [0, 1, 2].map(channel => pixels.filter((_, i) => i % 4 === channel).sort((x, y) => x - y)[32]);
  const url = address ? new URL(address) : null;
  return {
    color: `rgb(${r},${g},${b})`,
    dark: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5,
    host: url && (url.protocol === 'file:' ? basename(url.pathname) : url.host.replace(/^www\./, '')),
  };
}

function pill(context, x, width, y, unit, theme) {
  context.beginPath();
  context.roundRect(x, y - 18 * unit, width, 36 * unit, 18 * unit);
  context.fillStyle = theme.fill;
  context.fill();
  context.lineWidth = unit;
  context.strokeStyle = theme.border;
  context.stroke();
}

function polyline(context, points) {
  context.beginPath();
  points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.stroke();
}

// Each icon at its measured place: `at(x, y)` maps toolbar points to canvas pixels.
function drawIcons(context, at, width, unit, theme, addressLeft, addressRight) {
  context.lineWidth = 1.4 * unit;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = theme.ink;
  context.fillStyle = theme.ink;
  const box = (x, y, w, h, radius) => {
    context.beginPath();
    context.roundRect(...at(x, y), w * unit, h * unit, radius * unit);
    context.stroke();
  };

  // Sidebar, with its menu chevron.
  box(105, middle - 7.5, 19, 15, 3.5);
  polyline(context, [at(111.5, middle - 7.5), at(111.5, middle + 7.5)]);
  for (const y of [-4, -1.5, 1]) polyline(context, [at(107.3, middle + y), at(109.3, middle + y)]);
  polyline(context, [at(139.5, middle - 2), at(143.5, middle + 2), at(147.5, middle - 2)]);
  // Back, divider, and forward (dimmed: there is no forward history).
  polyline(context, [at(191.5, middle - 7), at(184.5, middle), at(191.5, middle + 7)]);
  context.save();
  context.strokeStyle = theme.border;
  context.lineWidth = unit;
  polyline(context, [at(207.5, middle - 10), at(207.5, middle + 10)]);
  context.globalAlpha = 0.35;
  context.strokeStyle = theme.ink;
  context.lineWidth = 1.4 * unit;
  polyline(context, [at(223.5, middle - 7), at(230.5, middle), at(223.5, middle + 7)]);
  context.restore();

  if (addressRight - addressLeft > 120) {
    // Page menu at the start of the address field, reload at its end.
    box(addressLeft + 9.5, middle - 8, 11, 7, 2);
    polyline(context, [at(addressLeft + 9.5, middle + 2), at(addressLeft + 20.5, middle + 2)]);
    polyline(context, [at(addressLeft + 9.5, middle + 5.5), at(addressLeft + 17, middle + 5.5)]);
    const [cx, cy] = at(addressRight - 14, middle + 0.5);
    context.beginPath();
    context.arc(cx, cy, 5.3 * unit, -Math.PI * 0.35, Math.PI * 1.35);
    context.stroke();
    polyline(context, [at(addressRight - 14.5, middle - 7.5), at(addressRight - 11.6, middle - 4.8), at(addressRight - 14.5, middle - 2.3)]);
  }

  // Share, new tab and tab overview.
  const right = width - 118;
  polyline(context, [at(right + 13, middle - 2), at(right + 11, middle - 2), at(right + 11, middle + 9), at(right + 24, middle + 9),
    at(right + 24, middle - 2), at(right + 22, middle - 2)]);
  polyline(context, [at(right + 17.5, middle + 3), at(right + 17.5, middle - 9)]);
  polyline(context, [at(right + 13.5, middle - 5.5), at(right + 17.5, middle - 9.5), at(right + 21.5, middle - 5.5)]);
  polyline(context, [at(right + 47, middle), at(right + 59, middle)]);
  polyline(context, [at(right + 53, middle - 6), at(right + 53, middle + 6)]);
  box(right + 85.5, middle - 4, 12.5, 12.5, 3);
  polyline(context, [at(right + 81.5, middle + 3.5), at(right + 81.5, middle - 5.5), at(right + 84.5, middle - 8.5), at(right + 92, middle - 8.5)]);
}

export function drawToolbar(context, frame, toolbar) {
  const { color, dark, host } = toolbar;
  const unit = frame.toolbar / toolbarHeight;
  const top = frame.y - frame.toolbar;
  const width = frame.width / unit;
  const at = (x, y) => [frame.x + x * unit, top + y * unit];
  const theme = dark
    ? { fill: '#ffffff17', border: '#ffffff2b', ink: '#e8e8e8', text: '#ffffff' }
    : { fill: '#0000000a', border: '#00000017', ink: '#3a3a3c', text: '#1d1d1f' };
  const y = top + middle * unit;
  context.save();
  context.beginPath();
  context.roundRect(frame.x, top, frame.width, frame.toolbar + 1, [frame.radius, frame.radius, 0, 0]);
  context.fillStyle = color;
  context.fill();

  lights.forEach((light, index) => {
    context.beginPath();
    context.arc(frame.x + (25 + index * 23) * unit, y, 7 * unit, 0, Math.PI * 2);
    context.fillStyle = light;
    context.fill();
    context.lineWidth = 0.5 * unit;
    context.strokeStyle = '#00000026';
    context.stroke();
  });
  pill(context, frame.x + 95 * unit, 68 * unit, y, unit, theme);
  pill(context, frame.x + 171 * unit, 72.5 * unit, y, unit, theme);
  // 41% of the window, centered, and clear of the controls on either side.
  const field = Math.min(width * 0.408, width - 520);
  const addressLeft = (width - field) / 2;
  if (field > 0) pill(context, frame.x + addressLeft * unit, field * unit, y, unit, theme);
  pill(context, frame.x + (width - 118) * unit, 109 * unit, y, unit, theme);
  drawIcons(context, at, width, unit, theme, addressLeft, addressLeft + field);

  if (host && field > 120) {
    context.font = `500 ${14 * unit}px ${systemFont}`;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = theme.text;
    context.fillText(host, frame.x + frame.width / 2, top + (middle + 5) * unit, (field - 70) * unit);
  }
  context.restore();
}
