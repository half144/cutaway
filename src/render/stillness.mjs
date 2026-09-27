import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { quietSpans } from './pacing.mjs';

const probe = { width: 192, height: 108 };
// A frame counts as a visible change when more than 0.1% of a small thumbnail differs noticeably.
const changedLevel = 8;
const changedShare = 0.001;

// Capture frames, inside stretches without user input, that look the same as the frame before: a
// blinking caret or a small spinner repaints the page without changing what the viewer sees.
export async function stillFrames(timeline, directory) {
  const spans = quietSpans(timeline);
  const canvas = createCanvas(probe.width, probe.height);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  async function thumbnail(index) {
    context.drawImage(await loadImage(await readFile(join(directory, timeline.frames[index].file))), 0, 0, probe.width, probe.height);
    const rgba = context.getImageData(0, 0, probe.width, probe.height).data;
    const gray = new Float32Array(probe.width * probe.height);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    return gray;
  }
  const still = new Set();
  let previous = null;
  for (const [index, frame] of timeline.frames.entries()) {
    if (index === 0 || !spans.some(span => frame.t > span.start && frame.t < span.end)) {
      previous = null;
      continue;
    }
    const before = previous ?? await thumbnail(index - 1);
    const current = await thumbnail(index);
    let changed = 0;
    for (let i = 0; i < current.length; i++) if (Math.abs(current[i] - before[i]) > changedLevel) changed++;
    if (changed / current.length < changedShare) still.add(index);
    previous = current;
  }
  return still;
}
