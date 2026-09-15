export const presetNames = new Set(['macos', 'dusk', 'midnight', 'pearl']);
export const pacingNames = new Set(['balanced', 'original']);
export const qualityNames = new Set(['high', 'standard']);

export function renderSettings(options = {}) {
  const {
    width = 1920,
    height = 1080,
    fps = 60,
    maxZoom = 1.8,
    blur = 0.65,
    cursorSize = 1.45,
    padding = 0.09,
    preset = 'macos',
    pacing = 'balanced',
    quality = 'high',
  } = options;

  const ranges = [
    ['width', width, 320, 3840],
    ['height', height, 320, 3840],
    ['fps', fps, 24, 60],
    ['maxZoom', maxZoom, 1, 3],
    ['blur', blur, 0, 1],
    ['padding', padding, 0, 0.25],
    ['cursorSize', cursorSize, 0.5, 3],
  ];
  for (const [name, value, min, max] of ranges) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Invalid ${name}: expected ${min}–${max}.`);
    }
  }

  if (width % 2 || height % 2 || !Number.isInteger(fps)) {
    throw new Error('Output dimensions must be even integers and fps must be an integer.');
  }
  if (!presetNames.has(preset)) throw new Error(`Unknown preset: ${preset}`);
  if (!pacingNames.has(pacing)) throw new Error(`Unknown pacing: ${pacing}`);
  if (!qualityNames.has(quality)) throw new Error(`Unknown quality: ${quality}`);

  return { width, height, fps, maxZoom, blur, cursorSize, padding, preset, pacing, quality };
}
