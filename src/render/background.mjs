import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

export const backgrounds = {
  macos: fileURLToPath(new URL('../../assets/macos-wallpaper.png', import.meta.url)),
  dusk: ['#292d52', '#69536c', '#d69383'],
  midnight: ['#09161e', '#203c48', '#557271'],
  pearl: ['#d5d1cc', '#e6e2dc', '#c6cbd1'],
};

export async function createBackdrop(width, height, frame, preset) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  if (typeof preset === 'string') {
    const wallpaper = await loadImage(preset);
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

  context.shadowColor = '#07071265';
  context.shadowBlur = 55;
  context.shadowOffsetY = 24;
  context.fillStyle = '#101318';
  context.beginPath();
  context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.radius);
  context.fill();
  return canvas;
}
