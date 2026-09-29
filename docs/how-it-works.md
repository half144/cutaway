# How it works

The details behind the defaults: how steps are paced, how the camera and cursor move, how the video is composed and how the code is laid out. The [README](../README.md) covers usage.

- [Step pacing](#step-pacing)
- [Camera](#camera)
- [Cursor](#cursor)
- [Typing and keys](#typing-and-keys)
- [Composition](#composition)
- [Phones](#phones)
- [Architecture](#architecture)
- [Performance](#performance)
- [Quality](#quality)
- [Notes for agents](#notes-for-agents)

## Step pacing

Without `pause`, the capture picks the rhythm: after clicks and keys it waits for animations and DOM changes to finish (up to 0.6 s) and records the area of the page that changed; then comes a short, varying breath like a person's, not a fixed beat. An `expect` result stays on screen for 0.6 s + 0.15 s per word of its headline (0.8–1.6 s), long enough to register the change without reading the whole panel; if the next step acts inside the result, the pause is short.

The camera frames the result together with the clicked control when both fit, or moves to it; a large result (page, dialog) is shown in the overview. `expect` doesn't check text or request completion: select a real success indicator. Ambiguous selectors, missing elements and unmet expectations stop the recording. The manifest records the error and export refuses incomplete sessions.

Recording starts once the page stops animating, with the cursor on a spot that opens no tooltip or hover.

With `balanced` pacing, stretches where nothing changes on screen (no gesture, click, key or scroll, and no visible repaint; a blinking text caret or a small spinner doesn't count) that last longer than 1.1 s keep 0.35 s of stillness at each end and play the middle faster, with continuous speed ramps capped at 4×. Movements, clicks and protected scrolls aren't compressed. An explicit `focus` keeps 1.8 s of reading time.

## Camera

Zoom is for local detail. A click whose effect fills the screen (the chart redraws, a panel opens, a column disappears) happens in the overview, without pushing in on the control only to pull out right after. Typing, menus and small effects get a close-up.

**Shots.** Local actions close in time (up to 3 s apart) form a single shot at a constant zoom level. Zoom holds for 1.8 s after the last click or 1.2 s after typing. Shots less than 1.5 s apart connect with a pan instead of returning to the overview; between close-ups up to 2.5 s apart on nearby subjects, the camera pulls back only halfway and returns; shots that would be too short are dropped instead of flashing. A manual scroll ends the shot; the auto-scroll to the next target doesn't. A `focus` too large to magnify and a large result (dialog, new page) hold the overview between shots.

**Timing.** The camera moves with the hand: zooms and pans start when the cursor sets off toward the target, and the cursor can roam the central 60% of the frame before the camera follows it. So the cursor is never dragged across the screen after it stops, and a zoom-out that would end just before the cursor leaves happens together with its departure. The video always opens on the whole page: a `focus` before the first gesture doesn't zoom, and the first push-in happens with the first mouse movement. If the next shot frames the revealed result itself (for example, a `focus` on it up to 3.5 s later), the camera goes straight from the close-up to it. After a click, the zoom returns to the overview on its normal schedule even if the app is still loading.

**Framing.** When a shot's whole region fits in the frame, the framing stays still; otherwise the camera follows each target. In wide fields it frames the start of the text and follows the caret. The default level is 1.5×, reduced only when the region doesn't fit with a margin; a nearby, compact container is included when available. Focus regions are intersected with the viewport before framing, and containers larger than the visible area are centered when they don't fit in the comfort region.

**Motion.** Two cascaded critically damped springs over zoom (on a log scale) and pan: the camera starts without a jolt, reaches 90% in ~0.6 s and settles in ~1.2 s, like Screen Studio's zoom. The main spring's speed follows the time until the next change: up to 1.5× faster when the next action is imminent, 0.8× before a long pause. From the overview, the zoom grows straight toward the target; when leaving, it pulls back from the same framing. The animated position uses the space available at the current zoom, without clamping after the spring, which avoids jumps when leaving a close-up near the edges. At the end, the video waits for the last zoom-out to settle (1.2 s) and holds still for another 0.4 s.

**Edges.** Near the edges, as in Screen Studio, the camera may show the wallpaper, limited to the scene plus its margin and to about 10% of the frame in close-ups.

## Cursor

The cursor is redrawn from the capture data.

| Aspect | Behavior |
| --- | --- |
| Smoothing | Drawn through a spring (stiffness 470, damping 70, mass 3, Screen Studio's default) that chases the hand slightly ahead: it starts gently, rounds corners and settles on arrival. Near each click it is pinned to the exact point, as in Cap and OpenScreen. Between capture samples, the path uses monotonic cubic interpolation, which preserves positions and click times without overshoot. |
| Path | A visible arc (4–7% of the distance at its widest) always to the same side, with curvature and shape varying per gesture, peak speed before the midpoint and a long deceleration. Only small targets (< 24 px) get a final correction, of at most 120 ms. |
| Duration | Fitts' law for a nimble presenter, with lognormal variation and a readable top speed. The path is recorded with its planned timing: a busy page doesn't stretch the stroke on screen. |
| Pauses | Still while the result appears. When the next target is already on screen and there is time, the hand moves to it in a single stroke and waits on top of it; the camera leaves with that stroke. No slow drifts, two-step approaches or random jitter. |
| Click | The wait before clicking varies like a person's (longer on small targets and before saving, deleting or confirming). The pointer shrinks to 0.8× in the 130 ms before the button goes down, stays pressed for at most 0.14 s and springs back with a slight rebound (1.04×). |
| Shape | Arrow, hand and I-beam are read from the DOM; a change crossfades and scales over 0.2 s. Custom canvas/iframe cursors aren't captured. |
| Tilt | 1° per 480 px/s of horizontal speed, up to 8°. |
| Visibility | Hides when typing starts, as on macOS, and reappears 250 ms before moving. Also hides after 3.5 s idle (never during a scroll), or just before the camera moves on its own and would drag the idle cursor more than 1/16 of the frame width. Fades take ~0.2 s; hides shorter than 0.5 s are skipped so it doesn't blink. |
| Size | Grows slightly with zoom. |

## Typing and keys

Before typing, the hand takes 0.25–0.45 s to go from the mouse to the keyboard; a field that already has content is selected (the highlight shows for ~0.2 s) and overwritten. Typing has lognormal intervals around 100 words per minute, a slower first key in each word, pauses after commas and periods, and occasional hesitations mid-word.

Modifier shortcuts (for example `ControlOrMeta+K`) and named keys that change the page on their own (Esc, Enter, Tab) appear in a dark pill at the bottom of the video; a lone Esc or Enter doesn't hide the cursor.

Auto-scroll glides the target, and the next target when it fits too, to just above the middle of the screen instead of pinning it to the edge. Scrolls are captured in 4× slow motion and played back at real speed: the browser delivers 11–50 fps while it paints new content at 2×, so a real-time capture stepped visibly; in slow motion every output frame gets its own capture (~200 fps effective in the dashboard demo).

## Composition

**Source.** New captures use lossless PNG and `captureScale: 2`: a 1440×810 viewport produces 2880×1620 frames without changing the page layout. Chromium uses matching physical and emulated scale, verified on every frame. Zoom samples the original image directly instead of downscaling the page before magnifying it. `captureScale: 3` gives 4K exports more resolution headroom, within the 8192-pixel-per-dimension limit.

**Motion blur.** Integrates temporal samples of camera and cursor motion, spaced at most ~2 px apart (up to 16 per frame in `high`). The page is rasterized once per frame and the blur samples reuse that image with a small offset; it doesn't apply a uniform blur to the screen or synthesize in-between interface frames.

**Scene.** The window has a vector browser bar drawn after Safari 26 on macOS Tahoe, measured on a Retina screenshot: a 52 pt bar, 26 pt corners (Tahoe's radius for toolbar windows), traffic lights, and the sidebar, back/forward, address (host only) and share/new tab/tabs controls in pills. Like Safari, the bar takes the color of the top of the page, and stands out from the background only through a three-layer shadow, with no outline, as in Screen Studio. No dark fill sits under the window, so the page's anti-aliased edge blends straight into the wallpaper. Wallpaper, margin, window, page and cursor form a single scene: during zoom the whole scene scales and moves continuously with the camera.

**Wallpapers.** The default is Sonoma Horizon, available after `npm run wallpapers`; without imported wallpapers it uses the macOS wallpaper saved at `assets/macos-wallpaper.png` (preset `macos`). The image fills the output without distortion, center-cropped when needed. `npm run wallpapers` converts the macOS wallpapers installed on this Mac (plus a still from video wallpapers such as Tahoe) to 4K JPEG in `assets/wallpapers/`; `node scripts/import-wallpapers.mjs --download` also downloads the ones macOS only fetches on demand (Big Sur, Catalina, Chroma, Dome, Peak, Hello…) from the official catalog System Settings uses (~1.5 GB, cached in `~/Library/Caches/cutaway`). Each file becomes a preset by name. The folder is kept out of git: the wallpapers belong to Apple and must not be redistributed.

**Output.** H.264/MP4 with fast-start for web playback, tagged 1-13-1 (BT.709 primaries and matrix, sRGB transfer) in the bitstream and the `colr` atom, so QuickTime and Safari don't wash out the colors. The video file is replaced only after a successful export.

## Phones

- **Gestures:** taps and drags are CDP touch events, so the page receives real touch and pointer events, clicks and native scrolling. Between taps the thumb travels unseen: its travel time (Fitts' law) is the beat before the tap, and the camera sets off with it. A scroll is a finger drag that departs quickly and comes to rest before lifting; long scrolls take several strokes of at most 60% of the screen. Auto-scroll to a target out of view is a drag too, down the page and then sideways along a table wider than the screen. A drag starts where the fingertip touches no control or chart.
- **Animations:** what a tap or key sets off (a sheet sliding up, a menu fading in) is captured in slow motion: Chromium runs the page's CSS animations and transitions 4× slower (`Animation.setPlaybackRate`) until the interface settles, and the render plays that span back at real speed. At 3× the screencast delivers ~20 fps, 9 frames for a 0.4 s sheet; in slow motion it gets ~110 per second of video. JavaScript timers and `requestAnimationFrame` animations keep real time, so they play faster during that span.
- **Touch indicator:** a translucent white disc the size of a fingertip (44 pt) with a faint ring. It grows in as the finger lands, follows drags, lingers 0.15 s after the finger lifts and fades out in 0.3 s while spreading to 1.33×, like the iOS show-touches tools ([ShowTime](https://github.com/KaneCheshire/ShowTime), [Fingertips](https://github.com/mapbox/Fingertips)).
- **Frame:** a vector phone around the page: dark titanium body, 55 pt screen corners, Dynamic Island and side buttons on iPhones, a punch-hole camera on Android. The status bar (9:41, signal, Wi-Fi, battery) and the home indicator are drawn over bars in the color of the page's top and bottom edges.
- **Camera:** a close-up fills the video's width with the screen and only moves vertically. Swipes play in the overview.
- **Keyboard:** while text is typed, an iOS 26-style keyboard rises from the bottom, each key pops up above itself and a return key pressed right after typing lights up. Text without letters is typed on the 123 plane, and numeric fields get a number pad. A field the keyboard would cover is lifted above it, as iOS does. The keyboard is gone before the next tap. To draw the keys, the timeline keeps the typed characters, except in password fields.

## Architecture

```text
Plan → Playwright / Chromium → PNGs + timestamped events
                                       ↓
                       Camera + Skia composition → FFmpeg → MP4
```

```text
src/
├── cli.mjs                 CLI entry point
├── cli/options.mjs         flag parsing and normalization
├── capture/
│   ├── record.mjs          orchestrates the recording session
│   ├── actions.mjs         runs steps and cursor movement
│   ├── touch.mjs           phone gestures: taps, drags and keys
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
│   ├── device.mjs          phone frame, system bars and screen
│   ├── keyboard.mjs        phone keyboard while typing
│   ├── touch.mjs           touch indicators
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
└── plan.mjs                plan validation
```

`src/record.mjs` and `src/render.mjs` remain as public facades to keep existing imports stable.

| Dependency | Role |
| --- | --- |
| [Playwright](https://playwright.dev/) | Actions, selectors and Chromium control |
| [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast) | Frames timestamped by the compositor, with no screenshot polling |
| [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) | Native composition with Skia |
| [FFmpeg](https://ffmpeg.org/) | H.264 encoding and MP4 muxing |

References studied: [Screen Studio — animations](https://screen.studio/guide/animations), [cursor](https://screen.studio/guide/cursor), [auto zoom](https://screen.studio/guide/auto-zoom), [Recordly](https://github.com/webadderallorg/Recordly) and [OpenScreen](https://github.com/siddharthvaddem/openscreen). None of their code or assets was incorporated.

## Performance

Capture and rendering are sequential and independent. Camera and cursor are simulated once for the whole video, so every output frame depends only on its own state and the camera of the frame before. The export splits the frames into contiguous segments of about equal work (a moving camera costs a page raster and its blur samples) and renders them in parallel processes, up to half the CPU cores and one per 2 GB of memory, each with its own encoder; FFmpeg then joins the segments without re-encoding. A lossless test render produced the same 1,574 frames, bit for bit, in one process and in five.

Each process keeps only the current source frame and composition buffers (~0.3 GB at 1080p). The reported memory doesn't include the Chromium or FFmpeg processes. Run one export at a time: a second one competes for the same cores.

On an Apple M4 a 26 s demo exports in ~46 s at the default 1080p60 `high`, and in ~17 s at 1280×720 with `--quality standard`. GPU composition and a hardware encoder still need implementation and benchmarking.

## Quality

Measured 2026-09-15. The `high` default uses a 2× PNG source, direct composition, up to 16 temporal samples and H.264 CRF 16. `standard` uses x264 `veryfast` at CRF 16 and up to five samples. Measured against a lossless master of the same render, `standard` matches the fidelity of the previous `fast`/CRF 18 (PSNR 48.4 vs 48.8 dB) with 45% less encoding CPU; `high` stays at 50.6 dB. The render reports the source resolution and pixel headroom at the highest zoom; values below 1 mean existing pixels are being magnified.

More: [encoder alternatives](motion-review.md), [map of improvements, references and limits](quality-review.md) and the [technical history](history.md).

## Notes for agents

The skill reuses the URL, selectors and state already known from the task. Preparation should investigate only what the plan is missing; it doesn't require auditing the project, reinstalling, a full rehearsal or a preview export. `record` checks dependencies before the actions and delivers the MP4 in a single run.

Help and validation load only the modules they need and work without Canvas, Chromium or FFmpeg installed. Install dependencies in the tool's repository, never in the filmed project by mistake. The skill's runner works from another directory using absolute paths.

`workflow.json` records preflight, browser setup, recording, export and the CLI total. Setup is part of the recording time and shouldn't be added again. The agent's preparation before the call isn't measured. Export failures explain how to reuse the capture with `render`.
