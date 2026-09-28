import { spawn } from 'node:child_process';
import { rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ffmpeg as ffmpegPath } from '../ffmpeg.mjs';

export class VideoEncoder {
  constructor(path, width, height, fps, quality = 'high') {
    this.error = null;
    this.stderr = '';
    this.process = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0',
      // Against a lossless master, `veryfast` at CRF 16 matches the fidelity of `fast` at 18 with half the CPU.
      '-an', '-c:v', 'libx264', '-preset', quality === 'high' ? 'medium' : 'veryfast', '-crf', '16',
      // The capture is sRGB: tag it 1-13-1 so QuickTime and Safari decode with the sRGB curve instead
      // of shifting gamma as they do for BT.709 or untagged video. FFmpeg 7.1+ takes these tags from the
      // filtered frames and ignores -color_trc/-color_primaries, so `setparams` writes them.
      '-vf', ['scale=in_range=full:out_range=tv:out_color_matrix=bt709', 'format=yuv420p',
        'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv'].join(','),
      path,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    this.process.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });
    this.process.stdin.on('error', error => {
      this.error = error;
    });
    this.completion = new Promise(resolveExit => {
      this.process.on('error', error => {
        this.error = error;
        resolveExit(-1);
      });
      this.process.on('close', code => resolveExit(code));
    });
  }

  assertHealthy() {
    if (this.error) throw this.error;
  }

  async write(buffer) {
    this.assertHealthy();
    await new Promise((resolve, reject) => {
      this.process.stdin.write(buffer, error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async finish() {
    this.process.stdin.end();
    const code = await this.completion;
    if (code !== 0) {
      throw new Error(`FFmpeg failed (${code}): ${this.stderr || this.error?.message}`);
    }
  }

  async abort() {
    this.process.stdin.destroy();
    this.process.kill('SIGTERM');
    await this.completion;
  }
}

// Joins segments encoded with identical settings without re-encoding. The concat demuxer keeps each
// segment's timestamps, so B-frames and the color tags survive; the output is replaced only on success.
export async function concatSegments(segments, outputPath) {
  const directory = dirname(segments[0]);
  const list = join(directory, 'segments.txt');
  await writeFile(list, segments.map(segment => `file '${basename(segment)}'\n`).join(''));
  const temporaryPath = join(directory, 'joined.mp4');
  const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
    '-i', list, '-c', 'copy', '-movflags', '+faststart', temporaryPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  ffmpeg.stderr.on('data', chunk => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const code = await new Promise(resolveExit => {
    ffmpeg.on('error', error => {
      stderr ||= error.message;
      resolveExit(-1);
    });
    ffmpeg.on('close', resolveExit);
  });
  if (code !== 0) throw new Error(`FFmpeg failed to join segments (${code}): ${stderr}`);
  await rename(temporaryPath, outputPath);
}
