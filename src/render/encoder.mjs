import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';

export class VideoEncoder {
  constructor(outputPath, width, height, fps, quality = 'high') {
    this.outputPath = outputPath;
    this.temporaryPath = `${outputPath}.${randomUUID()}.partial.mp4`;
    this.error = null;
    this.stderr = '';
    this.process = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0',
      '-an', '-c:v', 'libx264', '-preset', quality === 'high' ? 'medium' : 'fast',
      '-crf', quality === 'high' ? '16' : '18',
      // The capture is sRGB: tag it 1-13-1 so QuickTime and Safari decode with the sRGB curve instead
      // of shifting gamma as they do for BT.709 or untagged video. FFmpeg 7.1+ takes these tags from the
      // filtered frames and ignores -color_trc/-color_primaries, so `setparams` writes them.
      '-vf', ['scale=in_range=full:out_range=tv:out_color_matrix=bt709', 'format=yuv420p',
        'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv'].join(','),
      '-movflags', '+faststart', this.temporaryPath,
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
    await rename(this.temporaryPath, this.outputPath);
  }

  async abort() {
    this.process.stdin.destroy();
    this.process.kill('SIGTERM');
    await this.completion;
    await unlink(this.temporaryPath).catch(error => {
      if (error.code !== 'ENOENT') process.stderr.write(`${error.message}\n`);
    });
  }
}
