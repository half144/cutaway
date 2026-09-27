import { backgrounds, defaultPreset } from './wallpapers.mjs';

export const presetNames = new Set(Object.keys(backgrounds));
export const pacingNames = new Set(['balanced', 'original']);
export const qualityNames = new Set(['high', 'standard']);
export const windowNames = new Set(['browser', 'none']);
export const keyModes = new Set(['combos', 'all', 'none']);

export function renderSettings(options = {}) {
  const {
    width = 1920,
    height = 1080,
    fps = 60,
    maxZoom = 1.5,
    blur = 0.75,
    cursorSize = 2,
    padding = 0.09,
    preset = defaultPreset,
    pacing = 'balanced',
    quality = 'high',
    window = 'browser',
    keys = 'combos',
  } = options;

  const ranges = [
    ['width', width, 320, 3840],
    ['height', height, 320, 3840],
    ['fps', fps, 24, 60],
    ['maxZoom', maxZoom, 1, 3],
    ['blur', blur, 0, 1],
    ['padding', padding, 0, 0.25],
    ['cursorSize', cursorSize, 0.5, 4],
  ];
  for (const [name, value, min, max] of ranges) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Invalid ${name}: expected ${min}–${max}.`);
    }
  }

  if (width % 2 || height % 2 || !Number.isInteger(fps)) {
    throw new Error('Output dimensions must be even integers and fps must be an integer.');
  }
  if (!presetNames.has(preset)) throw new Error(`Unknown preset: ${preset}. Available: ${[...presetNames].join(', ')}.`);
  if (!pacingNames.has(pacing)) throw new Error(`Unknown pacing: ${pacing}`);
  if (!qualityNames.has(quality)) throw new Error(`Unknown quality: ${quality}`);
  if (!windowNames.has(window)) throw new Error(`Unknown window: ${window}`);
  if (!keyModes.has(keys)) throw new Error(`Unknown keys: ${keys}`);

  return { width, height, fps, maxZoom, blur, cursorSize, padding, preset, pacing, quality, window, keys };
}
