import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const imported = fileURLToPath(new URL('../../assets/wallpapers/', import.meta.url));

// macOS wallpapers brought in by `npm run wallpapers`, by file name.
function importedWallpapers() {
  if (!existsSync(imported)) return {};
  return Object.fromEntries(readdirSync(imported).filter(file => /\.(jpe?g|png)$/i.test(file))
    .map(file => [file.replace(/\.[^.]+$/, ''), join(imported, file)]));
}

export const backgrounds = {
  macos: fileURLToPath(new URL('../../assets/macos-wallpaper.png', import.meta.url)),
  ...importedWallpapers(),
  dusk: ['#292d52', '#69536c', '#d69383'],
  midnight: ['#09161e', '#203c48', '#557271'],
  pearl: ['#d5d1cc', '#e6e2dc', '#c6cbd1'],
};

// Sonoma Horizon at dusk once imported; the bundled wallpaper otherwise.
export const defaultPreset = backgrounds['sonoma-horizon'] ? 'sonoma-horizon' : 'macos';
// Screenshots sit on the dark Sonoma once imported.
export const framePreset = backgrounds['sonoma-night'] ? 'sonoma-night' : defaultPreset;
