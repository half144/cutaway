import { Camera, clamp, pointerAt } from '../motion.mjs';
import { CursorTrack } from './cursor.mjs';
import { exportDuration, planShots, shotTarget } from './focus.mjs';

// Camera and pointer state for every output frame. The camera is simulated first so the pointer
// can hide before a camera move that would drag it across the frame while the hand rests.
// `ratio` converts page pixels to output pixels at zoom 1; `top` extends the page upward (toolbar).
export function renderTracks(timeline, { scene, level, fps, top, ratio, width, height }) {
  const { viewport } = timeline;
  const { shots, report } = planShots(timeline, { scene, level });
  const duration = exportDuration(timeline, shots);
  const camera = new Camera(viewport.width, viewport.height, { top, sceneWidth: scene.width, sceneHeight: scene.height });
  const cameraStates = [];
  // Moments the camera changes course; the time to the next one sets how briskly it moves now.
  const changes = [...new Set(shots.flatMap(shot => [shot.startAt, shot.releaseAt, ...shot.targets.map(target => target.from)]))]
    .sort((a, b) => a - b);
  let changeIndex = 0;
  let pointIndex = 0;
  let shotIndex = -1;
  for (let i = 0; i < Math.ceil(duration * fps); i++) {
    const t = i / fps;
    const sampled = pointerAt(timeline.points, t, pointIndex);
    pointIndex = sampled.index;
    while (shotIndex + 1 < shots.length && shots[shotIndex + 1].startAt <= t) shotIndex++;
    const shot = shots[shotIndex];
    const active = shot && t < timeline.duration && t <= shot.releaseAt ? shot : null;
    const focus = active && { ...shotTarget(active, t).region, plannedZoom: active.zoom, shot: active.id };
    while (changeIndex < changes.length && changes[changeIndex] <= t) changeIndex++;
    const untilNext = (changes[changeIndex] ?? Infinity) - t;
    // The closing zoom-out keeps the usual pace so the video ends at rest.
    const response = untilNext === Infinity ? 1 : 1.5 - 0.7 * clamp((untilNext - 0.5) / 1.5, 0, 1);
    cameraStates.push({ t, ...camera.update(focus, active?.manual ? null : sampled.pointer, 1 / fps, response) });
  }
  const cursorTrack = new CursorTrack(timeline, fps, { camera: cameraStates, ratio, width, height });
  const frames = cameraStates.map(({ t, ...state }) => ({ t, camera: state, cursor: cursorTrack.update(t) }));
  return { shots, report, duration, frames };
}
