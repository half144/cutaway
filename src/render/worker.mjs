import { composeSegment } from './compose.mjs';

// Renders one segment for render(). When the parent disconnects (another segment failed, or it exited),
// the segment stops at the next frame and takes its encoder down with it.
const controller = new AbortController();
process.on('disconnect', () => controller.abort());

process.once('message', async job => {
  try {
    const result = await composeSegment(job, {
      signal: controller.signal,
      onProgress: frames => process.connected && process.send({ progress: frames }),
    });
    process.send({ result });
  } catch (error) {
    if (process.connected) process.send({ error: error.message });
  }
  if (process.connected) process.disconnect();
});
