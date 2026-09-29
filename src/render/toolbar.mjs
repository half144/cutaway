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
  context.lineWidth = 1.5 * unit;
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
  box(105.5, middle - 6.8, 18.5, 13.6, 3.5);
  polyline(context, [at(111.5, middle - 6.8), at(111.5, middle + 6.8)]);
  context.save();
  context.lineWidth = unit;
  for (const y of [-4, -1.5, 1]) polyline(context, [at(107.3, middle + y), at(109.3, middle + y)]);
  context.restore();
  polyline(context, [at(139.5, middle - 2), at(143.5, middle + 2), at(147.5, middle - 2)]);
  // Back, divider, and forward (dimmed: there is no forward history).
  polyline(context, [at(191.5, middle - 7), at(184.5, middle), at(191.5, middle + 7)]);
  context.save();
  context.strokeStyle = theme.border;
  context.lineWidth = unit;
  polyline(context, [at(207.5, middle - 10), at(207.5, middle + 10)]);
  context.globalAlpha = 0.35;
  context.strokeStyle = theme.ink;
  context.lineWidth = 1.5 * unit;
  polyline(context, [at(223.5, middle - 7), at(230.5, middle), at(223.5, middle + 7)]);
  context.restore();

  if (addressRight - addressLeft > 120) {
    // Page menu at the start of the address field, reload at its end, drawn finer than the others.
    context.save();
    context.lineWidth = unit;
    box(addressLeft + 11.5, middle - 5.5, 10.5, 6.5, 1.8);
    polyline(context, [at(addressLeft + 11.5, middle + 3.5), at(addressLeft + 22, middle + 3.5)]);
    polyline(context, [at(addressLeft + 11.5, middle + 6.5), at(addressLeft + 18.5, middle + 6.5)]);
    const [cx, cy] = at(addressRight - 14, middle + 1.8);
    context.beginPath();
    context.arc(cx, cy, 5 * unit, -Math.PI * 0.35, Math.PI * 1.35);
    context.stroke();
    polyline(context, [at(addressRight - 14.5, middle - 5.7), at(addressRight - 11.8, middle - 3.2), at(addressRight - 14.5, middle - 0.9)]);
    context.restore();
  }

  // Share, new tab and tab overview. The share box opens around its arrow, and the front tab hides a
  // corner of the one behind: both are cut out of the stroke with an even-odd clip.
  const right = width - 118;
  const without = (x, y, w, h, radius, draw) => {
    context.save();
    context.beginPath();
    context.rect(...at(right, 0), 118 * unit, toolbarHeight * unit);
    context.roundRect(...at(right + x, middle + y), w * unit, h * unit, radius * unit);
    context.clip('evenodd');
    draw();
    context.restore();
  };
  without(15.6, -4, 6.3, 4, 0, () => box(right + 12.2, middle - 1.8, 13.1, 9.8, 3));
  polyline(context, [at(right + 18.75, middle + 3), at(right + 18.75, middle - 9.2)]);
  polyline(context, [at(right + 15.6, middle - 6.1), at(right + 18.75, middle - 9.3), at(right + 21.9, middle - 6.1)]);
  polyline(context, [at(right + 47.75, middle), at(right + 59.75, middle)]);
  polyline(context, [at(right + 53.75, middle - 6), at(right + 53.75, middle + 6)]);
  without(84.6, -5.4, 15.9, 15.6, 5, () => box(right + 82.3, middle - 8, 11.5, 11.2, 3));
  box(right + 86.8, middle - 3.2, 11.5, 11.2, 3);
}

// The edge every macOS window has, measured on Safari: in dark mode a black hairline outside and a
// 1 pt light rim inside, brightest along the top (white at ~35%, ~20% down the sides); in light mode
// a faint dark hairline. Without it the window reads as a rectangle pasted on the wallpaper.
export function drawWindowEdge(context, frame, toolbar) {
  const unit = frame.toolbar / toolbarHeight;
  const x = frame.x, y = frame.y - frame.toolbar, width = frame.width, height = frame.height + frame.toolbar;
  const outline = (inset, radius) => {
    context.beginPath();
    context.roundRect(x + inset, y + inset, width - inset * 2, height - inset * 2, radius);
    context.stroke();
  };
  context.save();
  context.lineWidth = 0.5 * unit;
  context.strokeStyle = toolbar.dark ? '#000000a6' : '#0000001f';
  outline(-0.25 * unit, frame.radius + 0.25 * unit);
  if (toolbar.dark) {
    const rim = context.createLinearGradient(0, y, 0, y + height);
    rim.addColorStop(0, '#ffffff5c');
    rim.addColorStop(Math.min(1, 3 * unit / height), '#ffffff38');
    rim.addColorStop(Math.min(1, 40 * unit / height), '#ffffff2e');
    rim.addColorStop(1, '#ffffff24');
    context.lineWidth = unit;
    context.strokeStyle = rim;
    outline(0.5 * unit, frame.radius - 0.5 * unit);
  }
  context.restore();
}

export function drawToolbar(context, frame, toolbar) {
  const { color, dark, host } = toolbar;
  const unit = frame.toolbar / toolbarHeight;
  const top = frame.y - frame.toolbar;
  const width = frame.width / unit;
  const at = (x, y) => [frame.x + x * unit, top + y * unit];
  const theme = dark
    ? { fill: '#ffffff17', border: '#ffffff2b', ink: '#dcdcdc', text: '#ffffff' }
    : { fill: '#0000000f', border: '#00000014', ink: '#3a3a3c', text: '#1d1d1f' };
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
    context.font = `500 ${14.5 * unit}px ${systemFont}`;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = theme.text;
    context.fillText(host, frame.x + frame.width / 2, top + (middle + 5) * unit, (field - 70) * unit);
  }
  context.restore();
}
