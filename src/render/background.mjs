import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { drawDeviceBody } from './device.mjs';

export { backgrounds } from './wallpapers.mjs';

// Ambient, key and contact shadows (1080p pixels) give the window depth without a hard edge.
const shadows = [
  { offset: 26, blur: 72, color: '#0000004d' },
  { offset: 9, blur: 24, color: '#00000033' },
  { offset: 2, blur: 5, color: '#0000002e' },
];

// A phone's body is drawn here too: it sits still in the scene, like the wallpaper.
export async function createBackdrop(width, height, window, preset, device) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  if (typeof preset === 'string') {
    const wallpaper = await loadImage(await readFile(preset));
    const scale = Math.max(width / wallpaper.width, height / wallpaper.height);
    const scaledWidth = wallpaper.width * scale;
    const scaledHeight = wallpaper.height * scale;
    context.drawImage(wallpaper, (width - scaledWidth) / 2, (height - scaledHeight) / 2, scaledWidth, scaledHeight);
  } else {
    const gradient = context.createLinearGradient(0, 0, width * 0.8, height);
    preset.forEach((color, index) => gradient.addColorStop(index / 2, color));
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(width * 0.2, height, 0, width * 0.2, height, width * 0.8);
    glow.addColorStop(0, '#ffffff20');
    glow.addColorStop(1, '#ffffff00');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }

  // Only the shadows are painted: the window shape sits off canvas and casts its shadow into place.
  // A filled base would show through the page's anti-aliased edge as a thin dark outline.
  const unit = height / 1080;
  const away = width * 4;
  context.fillStyle = '#000000';
  for (const shadow of shadows) {
    context.shadowColor = shadow.color;
    context.shadowBlur = shadow.blur * unit;
    context.shadowOffsetX = away;
    context.shadowOffsetY = shadow.offset * unit;
    context.beginPath();
    context.roundRect(window.x - away, window.y, window.width, window.height, window.radius);
    context.fill();
  }
  if (device) {
    context.shadowColor = 'transparent';
    drawDeviceBody(context, window, device);
  }
  return canvas;
}
