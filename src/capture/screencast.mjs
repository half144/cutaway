import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class ScreencastRecorder {
  constructor(session, directory, timeline, viewport, startedAt) {
    this.session = session;
    this.directory = directory;
    this.timeline = timeline;
    this.viewport = viewport;
    this.startedAt = startedAt;
    this.pending = Promise.resolve();
    this.error = null;
    this.sequence = 1;
    this.started = false;
  }

  registerFrameHandler() {
    this.session.on('Page.screencastFrame', frame => {
      const file = `frames/${String(this.sequence++).padStart(6, '0')}.png`;
      const timestamp = frame.metadata.timestamp ? frame.metadata.timestamp * 1000 : Date.now();
      const t = Math.max(0, (timestamp - this.startedAt) / 1000);

      this.pending = this.pending.then(async () => {
        const data = Buffer.from(frame.data, 'base64');
        const width = data.readUInt32BE(16);
        const height = data.readUInt32BE(20);
        if (width !== this.viewport.width || height !== this.viewport.height) {
          throw new Error(`Capture resolution changed: expected ${this.viewport.width}×${this.viewport.height}, received ${width}×${height}.`);
        }
        await writeFile(join(this.directory, file), data);
        this.timeline.frames.push({ t, file });
        await this.session.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
      }).catch(error => {
        this.error = error;
      });
    });
  }

  async start() {
    this.registerFrameHandler();
    await this.session.send('Page.startScreencast', {
      format: 'png',
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
    });
    this.started = true;
  }

  assertHealthy() {
    if (this.error) throw this.error;
  }

  async stop() {
    try {
      if (this.started) await this.session.send('Page.stopScreencast');
    } finally {
      await this.pending;
      this.started = false;
    }
  }
}
