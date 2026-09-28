import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// The build ffmpeg-static downloads at install, which includes libx264, so a fresh install needs nothing
// else. It is an optional dependency: when its download is skipped or fails, FFmpeg on PATH is used.
function bundled() {
  try {
    const path = createRequire(import.meta.url)('ffmpeg-static');
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

export const ffmpeg = bundled() ?? 'ffmpeg';
