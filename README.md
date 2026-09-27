# Agent Screen

A local tool that lets agents record web app demos with animated zoom, a smooth cursor and video composition. First working version: a CLI, a skill and a complete example. Screen Studio is the visual reference; this project is not affiliated with it and does not yet match its editor.

## Example

https://github.com/user-attachments/assets/99199d3d-1066-4d4b-b7db-b0bda63ca106

26 s, 1080p, 60 fps, unedited. Recorded from [examples/web-dashboard.json](examples/web-dashboard.json) on the [shadcn/ui example dashboard](https://ui.shadcn.com/view/new-york-v4/dashboard-01): the agent edits a target, assigns a reviewer, renames a section in its detail panel and switches the chart range. Zoom, cursor, pacing and background (Sonoma Horizon) are the tool's defaults.

## Try it

Requires Node.js 22+, FFmpeg on the PATH and Playwright's Chromium.

```sh
npm ci
npx playwright install chromium
npm run demo
```

The demo opens a local mock app, edits a project name and shows the result. [examples/web-dashboard.json](examples/web-dashboard.json) records a real web app, the shadcn/ui example dashboard: it edits a target, assigns a reviewer, renames a section in its detail panel and switches the chart range. Everything runs locally in the browser, but the example depends on the site being up and its labels staying the same. The MP4 is written to `recordings/demo/video.mp4`. Use a new folder when recording again:

```sh
node src/cli.mjs record examples/demo.json --out recordings/my-demo
```

Install the skill in Codex:

```sh
node scripts/install-skill.mjs
```

The installer links `skills/agent-screen` into `$CODEX_HOME/skills` (or `~/.codex/skills`). This project folder must stay available. It does not replace an existing skill. The skill can be invoked as `$agent-screen` once the environment reloads its skill list.

## Scripts for agents

The agent inspects the app, finds the selectors and writes a JSON file like [examples/demo.json](examples/demo.json). The CLI runs the script in an isolated Chromium context. It uses no other AI model, service account or upload.

```json
{
  "url": "http://localhost:3000",
  "viewport": { "width": 1440, "height": 810 },
  "steps": [
    { "action": "click", "selector": "#edit", "pause": 1 },
    { "action": "type", "selector": "#title", "text": "New title" },
    { "action": "click", "selector": "#save", "expect": "#saved-message" },
    { "action": "focus", "selector": "#updated-title", "duration": 1.5 }
  ]
}
```

| Action | Parameters | Behavior |
| --- | --- | --- |
| `click` | `selector` | Moves the cursor like a person aiming, clicks and waits for the interface to settle |
| `type` | `selector`, `text` | Focuses the field, clears existing content and types at a human rhythm; doesn't re-click a field that already has focus |
| `focus` | `selector`, `duration` | Frames an element without clicking; tall regions are read from the top |
| `scroll` | `y`, `duration` | Relative scroll in pixels: starts fast and glides to a stop |
| `press` | `key` | Shortcut or key on the currently focused element; modifier combos appear in the video |
| `wait` | `duration` | Pause in seconds |

Every step accepts `pause` (seconds after the action) and `expect` (a selector that must become visible). Without `pause`, the capture picks the rhythm: after clicks and keys it waits for animations and DOM changes to finish (up to 0.6 s) and records the area of the page that changed; then comes a short, varying breath like a person's, not a fixed beat. An `expect` result stays on screen for 0.6 s + 0.15 s per word of its headline (0.8–1.6 s), long enough to register the change without reading the whole panel; if the next step acts inside the result, the pause is short. The camera frames the result together with the clicked control when both fit, or moves to it; a large result (page, dialog) is shown in the overview. `expect` doesn't check text or request completion: select a real success indicator. Ambiguous selectors, missing elements and unmet expectations stop the recording. The manifest records the error and export refuses incomplete sessions.

The default viewport is 1440×810 (16:9, like the export), so the window gets even margins. `file:./demo.html` is resolved relative to the JSON file. For an authenticated app, `--storage-state /path/session.auth.json` loads an existing Playwright state. `--headed` opens the browser with its UI.

## Finishing and export

```sh
# Capture without compositing
node src/cli.mjs record script.json --out recordings/delivery --capture-only

# Lightweight preview
node src/cli.mjs render recordings/delivery --width 1280 --height 720

# Re-export the same capture without repeating the actions
node src/cli.mjs render recordings/delivery --preset midnight --zoom 2 --window none
```

| Option | Default | Range |
| --- | --- | --- |
| `--width`, `--height` | 1920 × 1080 | 320–3840, even dimensions |
| `--fps` | 60 | 24–60, integer |
| `--zoom` | 1.5 | 1–3; close-up level; 1 turns zoom off |
| `--blur` | 0.75 | 0–1; 0 turns motion blur off |
| `--cursor-size` | 2 | 0.5–4 |
| `--padding` | 0.09 | 0–0.25 |
| `--preset` | sonoma-horizon (macos without imported wallpapers) | macos, dusk, midnight, pearl and the imported wallpapers (`tahoe-day`, `sonoma-horizon`, `big-sur`…) |
| `--window` | browser | browser (bar with traffic lights and address), none |
| `--keys` | combos | combos (shortcuts and named keys such as Esc, Enter, Tab), all, none |
| `--pacing` | balanced | balanced (speeds up dead time), original |
| `--quality` | high | high (x264 medium, CRF 16), standard (x264 veryfast, CRF 16: same fidelity as the old CRF 18, half the encoding time) |
| `--output` | `<recording>/video.mp4` | Alternative output path |

Zoom is for local detail. A click whose effect fills the screen (the chart redraws, a panel opens, a column disappears) happens in the overview, without pushing in on the control only to pull out right after. Typing, menus and small effects get a close-up. Local actions close in time (up to 3 s apart) form a single shot at a constant zoom level. The camera moves with the hand: zooms and pans start when the cursor sets off toward the target, and the cursor can roam the central 60% of the frame before the camera follows it. So the cursor is never dragged across the screen after it stops, and a zoom-out that would end just before the cursor leaves happens together with its departure. Zoom holds for 1.8 s after the last click or 1.2 s after typing. Shots less than 1.5 s apart connect with a pan instead of returning to the overview; between close-ups up to 2.5 s apart on nearby subjects, the camera pulls back only halfway and returns, instead of going to the overview; shots that would be too short are dropped instead of flashing. A manual scroll ends the shot; the auto-scroll to the next target doesn't. A `focus` too large to magnify and a large result (dialog, new page) hold the overview between shots. The video always opens on the whole page: a `focus` before the first gesture doesn't zoom, and the first push-in happens with the first mouse movement. If the next shot frames the revealed result itself (for example, a `focus` on it up to 3.5 s later), the camera goes straight from the close-up to it without passing through the overview. When a shot's whole region fits in the frame, the framing stays still; otherwise the camera follows each target. In wide fields it frames the start of the text and follows the caret. The default level is 1.5×, reduced only when the region doesn't fit with a margin; a nearby, compact container is included when available.

The camera uses two cascaded critically damped springs over zoom (on a log scale) and pan: it starts without a jolt, reaches 90% in ~0.6 s and settles in ~1.2 s, like Screen Studio's zoom. The main spring's speed follows the time until the next change: up to 1.5× faster when the next action is imminent, 0.8× before a long pause, so moves don't all last the same. From the overview, the zoom grows straight toward the target; when leaving, it pulls back from the same framing. At the end, the video waits for the last zoom-out to settle (1.2 s) and holds still for another 0.4 s. Near the edges, as in Screen Studio, the camera may show the wallpaper, limited to the scene plus its margin and to about 10% of the frame in close-ups.

The cursor is redrawn from the capture data:

- **Smoothing:** as in Screen Studio, the cursor is drawn through a spring (stiffness 470, damping 70, mass 3, Screen Studio's default) that chases the hand slightly ahead: it starts gently, rounds corners and settles on arrival, with no noticeable lag. Near each click it is pinned to the exact point, as in Cap and openscreen.
- **Path:** a visible arc (4–7% of the distance at its widest) always to the same side, with curvature and shape varying per gesture, peak speed before the midpoint and a long deceleration. Only small targets (< 24 px) get a final correction, of at most 120 ms; larger targets are hit in a single stroke.
- **Duration:** follows Fitts' law for a nimble presenter, with lognormal variation between gestures and a readable top speed. The path is recorded with its planned timing: a busy page doesn't stretch the stroke on screen.
- **Pauses:** the cursor stays still while the result appears, as in a real recording. When the next target is already on screen and there is time, the hand moves to it in a single stroke during the pause and waits on top of it; the camera leaves with that stroke. No slow drifts, two-step approaches or random jitter.
- **Click:** the wait before clicking varies like a person's (longer on small targets and before saving, deleting or confirming). The pointer shrinks to 0.8× in the 130 ms before the button goes down, stays pressed for at most 0.14 s and springs back with a slight rebound (1.04×).
- **Shape changes:** between arrow, hand and I-beam, the new shape appears with a 0.2 s crossfade and scale.
- **Tilt:** the pointer tilts 1° per 480 px/s of horizontal speed, up to 8°.
- **Visibility:** hides when typing starts, as on macOS, and reappears 250 ms before moving again. It also shrinks and hides after 3.5 s idle (never during a scroll), or just before the camera moves on its own and would drag the idle cursor more than 1/16 of the frame width, or out of the frame (a `focus` far from the pointer, a result's zoom-out). Fades take ~0.2 s with easing. Hides shorter than 0.5 s are skipped so the cursor doesn't blink, and a cursor that would hide before its first movement doesn't show at the opening.
- **Size:** grows slightly with zoom.

Before typing, the hand takes 0.25–0.45 s to go from the mouse to the keyboard; a field that already has content is selected (the highlight shows for ~0.2 s) and overwritten. Typing has lognormal intervals around 100 words per minute, a slower first key in each word, pauses after commas and periods, and occasional hesitations mid-word. Modifier shortcuts (for example `ControlOrMeta+K`) and named keys that change the page on their own (Esc, Enter, Tab) appear in a dark pill at the bottom of the video; a lone Esc or Enter doesn't hide the cursor. Auto-scroll glides the target, and the next target when it fits too, to just above the middle of the screen instead of pinning it to the edge.

Motion blur integrates temporal samples of camera and cursor motion, spaced at most ~2 px apart (up to 16 per frame in `high`). The page is rasterized once per frame, and the blur samples reuse that image with a small offset; it doesn't apply a uniform blur to the screen. New captures use lossless PNG and `captureScale: 2`: a 1440×810 viewport produces 2880×1620 frames without changing the page layout. Chromium uses matching physical and emulated scale, verified on every frame. Zoom samples the original image directly; it avoids downscaling the page before magnifying it. Use `captureScale: 3` in the script for 4K exports with more resolution headroom, within the 8192-pixel-per-dimension limit.

The default background is Sonoma Horizon (Sonoma hills at dusk), available after `npm run wallpapers`; without imported wallpapers it uses the user-supplied macOS wallpaper saved at `assets/macos-wallpaper.png` (preset `macos`). The image fills the output without distortion, center-cropped when needed. The gradient presets remain available. The window has a vector browser bar (traffic lights and address, without the query string), light or dark to match the top of the page, and stands out from the background only through a three-layer shadow, with no outline, as in Screen Studio: no dark fill sits under the window, so the page's anti-aliased edge blends straight into the wallpaper. Wallpaper, margin, window, page and cursor form a single scene: in the overview the margin shows around the screen and, during zoom, the whole scene scales and moves continuously with the camera. The wallpaper may remain visible at the edges when the framing calls for it, avoiding abrupt position changes during the animation. With `balanced` pacing, stretches where nothing changes on screen (no gesture, click, key or scroll, and no visible repaint; a blinking text caret or a small spinner doesn't count) that last longer than 1.1 s keep 0.35 s of stillness at each end and play the middle 3.5× faster; an explicit `focus` keeps 1.8 s of reading time. Recording starts once the page stops animating, with the cursor on a spot that opens no tooltip or hover. Output is H.264/MP4 with fast-start for web playback. The file is tagged 1-13-1 (BT.709 primaries and matrix, sRGB transfer), in the bitstream and the `colr` atom, so QuickTime and Safari don't wash out the colors.

More backgrounds: `npm run wallpapers` converts the macOS wallpapers installed on this Mac (plus a still from video wallpapers such as Tahoe) to 4K JPEG in `assets/wallpapers/`; `node scripts/import-wallpapers.mjs --download` also downloads the ones macOS only fetches on demand (Big Sur, Catalina, Chroma, Dome, Peak, Hello…), from the same official catalog System Settings uses (~1.5 GB, cached in `~/Library/Caches/agent-screen`). Each file becomes a preset by name (`--preset tahoe-day`). The folder is kept out of git: the wallpapers belong to Apple, are licensed with the Mac and must not be redistributed.

## Session files

- `frames/*.png`: lossless high-density source frames; older sessions with JPEG remain renderable.
- `timeline.json`: timestamps, cursor positions, clicks, focus regions and status.
- `video.mp4`: the composited video.
- `poster.png`: a frame from the middle of the export for quick inspection.
- `camera.json`: the camera path, for diagnostics.
- `render.json`: parameters and real measurements of export time, the number of render processes and their sampled memory, summed. `motion` summarizes movement for objective tuning: shots, share of the video spent zoomed, shortest close-up, shortest return to the overview (low values signal "pumping"), skipped focuses and capture fps during scroll.

The video file is replaced only after a successful export. Re-rendering may change the session's video and diagnostic files. The script contains the typed text; the manifest doesn't duplicate it, but the frames naturally show the page's visible content.

## Architecture and dependencies

```text
Agent script → Playwright / Chromium → PNGs + timestamped events
                                              ↓
                              Camera + Skia composition → FFmpeg → MP4
```

The code is split by the responsibility of each stage:

```text
src/
├── cli.mjs                 CLI entry point
├── cli/options.mjs         flag parsing and normalization
├── capture/
│   ├── record.mjs          orchestrates the recording session
│   ├── actions.mjs         runs steps and cursor movement
│   ├── pacing.mjs          pause, movement and typing timing
│   ├── page-state.mjs      DOM inspection, auto-scroll and caret position
│   └── screencast.mjs      captures, checks resolution and persists CDP frames
├── render/
│   ├── index.mjs           plans the export, renders segments in parallel and joins them
│   ├── segments.mjs        splits the frames into runs of about equal work
│   ├── worker.mjs          process that renders one segment
│   ├── compose.mjs         composes and encodes a run of frames
│   ├── background.mjs      wallpaper, gradients and window shadow
│   ├── wallpapers.mjs      background presets and the default
│   ├── toolbar.mjs         browser bar: tone and drawing
│   ├── scene.mjs           direct source composition and scene transform
│   ├── cursor-art.mjs      cursor vectors
│   ├── cursor.mjs          per-frame shape, visibility, tilt and click
│   ├── keys.mjs            shortcut pill
│   ├── focus.mjs           zoom shot planning
│   ├── tracks.mjs          per-frame camera and cursor, simulated before compositing
│   ├── metrics.mjs         motion metrics for `render.json`
│   ├── pacing.mjs          time compression of waits with smooth ramps
│   ├── stillness.mjs       detects frames with no visible change
│   ├── encoder.mjs         FFmpeg encoding and segment joining
│   └── settings.mjs        render defaults and validation
├── motion.mjs              camera, easing and cursor path
└── plan.mjs                script validation
```

`src/record.mjs` and `src/render.mjs` remain as public facades to keep existing imports stable.

- [Playwright](https://playwright.dev/): actions, selectors and Chromium control.
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast): frames timestamped by the compositor, with no screenshot polling for the video.
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas): native composition with Skia.
- [FFmpeg](https://ffmpeg.org/): H.264 encoding and MP4 muxing.

Capture and rendering are sequential and independent. Camera and cursor are simulated once for the whole video, so every output frame depends only on its own state and the camera of the frame before. The export splits the frames into contiguous segments of about equal work (a moving camera costs a page raster and its blur samples) and renders them in parallel processes, up to half the CPU cores and one per 2 GB of memory, each with its own encoder; FFmpeg then joins the segments without re-encoding. A lossless test render produced the same 1,574 frames, bit for bit, in one process and in five. Each process keeps only the current source frame and composition buffers (~0.3 GB at 1080p), applies adaptive sampling and respects its encoder's throughput. Camera metadata is proportional to duration; the source frames stay on disk. The reported memory doesn't include the Chromium or FFmpeg processes. Run one export at a time: a second one competes for the same cores.

References studied: [Screen Studio — animations](https://screen.studio/guide/animations), [cursor](https://screen.studio/guide/cursor), [auto zoom](https://screen.studio/guide/auto-zoom), [Recordly](https://github.com/webadderallorg/Recordly) and [OpenScreen](https://github.com/siddharthvaddem/openscreen). The last two are full editing applications; none of their code or assets was incorporated. The implementation uses the libraries listed above and keeps the script and framing logic in this project.

## Limits of this version

- Records scripts run by the CLI itself in a single Chromium tab; it doesn't record the history of the work or attach to a tab another agent is already using.
- Camera and cursor render at 60 fps by default. Interface capture follows the browser compositor's pace; 60 fps output doesn't guarantee 60 distinct app frames per second.
- No audio, webcam, native windows, popups, drag-and-drop or visual timeline editing.
- Page scrolling is captured as it happens; the temporal blur covers camera and cursor and doesn't synthesize in-between interface frames.
- Changing the output aspect ratio keeps the capture's aspect ratio and adds margin; there is no automatic reframing for vertical social formats yet.
- Uses Skia and libx264 on the CPU, in parallel processes. On an Apple M4 a 26 s demo exports in ~46 s at the default 1080p60 `high`, and in ~17 s at 1280×720 with `--quality standard` (previously ~140 s). GPU composition and a hardware encoder still need implementation and benchmarking.
- New captures record arrow, hand and I-beam from the DOM. Custom canvas/iframe cursors aren't captured; older sessions use the arrow.

## Verification

```sh
npm test
npm run check
```

The tests cover camera geometry and stability, cursor path and interpolation, and script validation. The local example exercises capture, typing, clicks, the final result, composition and encoding. Watching the MP4 is still necessary: these tests don't measure beauty or show equivalence to Screen Studio.

## Fast path for agents

The skill reuses the URL, selectors and state already known from the task. Preparation should investigate only what the script is missing; it doesn't require auditing the project, reinstalling, a full rehearsal or a preview export. The `record` command already checks dependencies before the actions and delivers the MP4 in a single run. The default remains 1080p/60 fps for showcase videos. For PR evidence, bug repros and previews, `--width 1280 --height 720 --quality standard` exports about 3× faster and keeps ~30 s of video under GitHub's 10 MB attachment limit on free plans.

```sh
# Optional diagnosis: reports the tool's repository and needed fixes
node src/cli.mjs doctor
# Optional validation, no browser; doesn't check selectors against the app
node src/cli.mjs validate examples/demo.json
```

Help and validation load only the modules they need and work without Canvas, Chromium or FFmpeg installed. Install dependencies in the tool's repository, never in the filmed project by mistake. The skill's runner works from another directory using absolute paths.

`workflow.json` records preflight, browser setup, recording, export and the CLI total. Setup is part of the recording time and shouldn't be added again. The agent's preparation before the call isn't measured. The CLI timings also appear in the final JSON. Export failures explain how to reuse the capture with `render`.

The camera intersects focus regions with the viewport before framing them. Containers larger than the visible area are centered when they don't fit in the comfort region. The animated position uses the space available at the current zoom, without clamping the position after the spring; this avoids jumps when leaving a close-up near the edges. The fix also applies to existing captures via `render`.

After a click, the zoom returns to the overview on its normal schedule even if the app is still loading. A manual `focus` respects its duration. In older captures, the real end of typing may not be separated from the wait for a result.

Between capture samples, the hand's path uses monotonic cubic interpolation, which preserves positions and click times without overshoot; the spring described above smooths the drawn cursor on top of it.

## Long demo

`examples/extended-demo.html` is a local mock workspace with a form, menus, checklist, notes, chart and report. `examples/extended-demo.json` runs 38 actions, including scrolling, focus on wide regions, keys, long typing and simulated loads. It doesn't reach external services.

```sh
node src/cli.mjs record examples/extended-demo.json --out recordings/extended-demo
```

Use a new folder when repeating. The deliberate loads let you evaluate the zoom pulling back after inactivity; the wide regions exercise legibility and automatic zoom reduction.

## Current quality (2026-09-15)

The `high` default uses a 2× PNG source, direct composition, up to 16 temporal samples and H.264 CRF 16. Conversion uses the BT.709 matrix with sRGB transfer tagged in the file. The encoder alternatives measured are in [docs/motion-review.md](docs/motion-review.md). `standard` uses x264 `veryfast` at CRF 16 and up to five samples, preserving the captured source. Measured against a lossless master of the same render, it matches the fidelity of the previous `fast`/CRF 18 (PSNR 48.4 vs 48.8 dB) with 45% less encoding CPU; `high` stays at 50.6 dB. The render reports the source resolution and pixel headroom at the highest zoom; values below 1 mean existing pixels are being magnified.

Compact groups share scale and framing region. Scrolls end old focuses and the camera opens before scrolling; the next push-in waits for the target to be available. Scrolling schedules events in real time and drops delays, keeping the requested duration. Typing varies at word and punctuation boundaries.

Long waits use continuous speed ramps, capped at 4×, keeping 550 ms at real speed at the edges. Movements, clicks and protected scrolls aren't compressed. Explicit `pause` and `focus` remain available for reading. [Map of improvements, references and limits](docs/quality-review.md).

Earlier reviews are in the [technical history](docs/history.md).
