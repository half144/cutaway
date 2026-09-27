import { Camera, clamp, framingMargin, pointerAt, safeZone } from '../motion.mjs';
import { CursorTrack } from './cursor.mjs';
import { exportDuration, planShots, shotTarget } from './focus.mjs';
import { keyboardAt, keyboardFocuses, keyboardSpans, liftedTouches } from './keyboard.mjs';
import { TouchTrack } from './touch.mjs';

// Camera and pointer state for every output frame. The camera is simulated first so the pointer
// can hide before a camera move that would drag it across the frame while the hand rests.
// `ratio` converts page pixels to output pixels at zoom 1; `top` extends the page upward (toolbar),
// `bounds` replaces it when the window also extends elsewhere (a phone's body). `keyboard` draws the
// phone's on-screen keyboard while text is typed, and the camera frames it with the field.
export function renderTracks(timeline, { scene, level, fps, top, bounds, ratio, width, height, keyboard = false }) {
  const { viewport } = timeline;
  const touch = timeline.input === 'touch';
  // A phone's page is narrow: the close-up fills the width with the screen (keeping a sliver of bezel)
  // and frames subjects by height alone, since the whole width stays in view.
  const zoom = touch ? Math.min(level, scene.width / (viewport.width + 16)) : level;
  const planning = touch
    ? { width: Math.max(scene.width, zoom * (viewport.width + framingMargin.x * 2) / safeZone), height: scene.height }
    : scene;
  const spans = keyboard ? keyboardSpans(timeline) : [];
  const typed = spans.length ? { ...timeline, focuses: keyboardFocuses(timeline, spans) } : timeline;
  const { shots, report } = planShots(typed, { scene: planning, level: zoom });
  const duration = exportDuration(timeline, shots);
  const camera = new Camera(viewport.width, viewport.height, {
    top, bounds, sceneWidth: scene.width, sceneHeight: scene.height, lockX: touch,
  });
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
    // An unseen thumb is not followed; the camera frames what it touches.
    const follow = active?.manual || touch ? null : sampled.pointer;
    cameraStates.push({ t, ...camera.update(focus, follow, 1 / fps, response) });
  }
  const cursorTrack = touch
    ? new TouchTrack({ touches: liftedTouches(timeline.touches ?? [], spans) }, fps)
    : new CursorTrack(timeline, fps, { camera: cameraStates, ratio, width, height });
  const frames = cameraStates.map(({ t, ...state }) => ({
    t, camera: state, cursor: cursorTrack.update(t), ...(keyboard && { keyboard: keyboardAt(spans, t) }),
  }));
  return { shots, report, duration, frames, keyboard: spans };
}
