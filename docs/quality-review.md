# Quality review — 2026-09-15

Camera, cursor, click, typing and composition were revised on 2026-09-26; see the [motion and finish review](motion-review.md). The capture and resolution decisions below still apply.

The goal is to improve legibility, continuity and pacing in web demos. The changes below are implemented. No code or assets were copied from the reference applications; the vector cursors in this version are our own.

## References consulted

- [Screen Studio: animations](https://screen.studio/guide/animations) separates cursor, zoom and pan settings and offers animation that settles to make reading easier.
- [Screen Studio: cursor](https://screen.studio/guide/cursor) documents shapes, hiding during inactivity, rotation and reducing rapid shape changes.
- [Recordly: constants](https://github.com/WizardofTryout/recordly/blob/main/src/components/video-editor/videoPlayback/constants.ts) and [zoom linking](https://github.com/WizardofTryout/recordly/blob/main/src/components/video-editor/videoPlayback/zoomRegionUtils.ts) use transition intervals and region linking. Reading them informs the design; the timings were not copied as a new preset.
- [Cap: camera planning](https://github.com/CapSoftware/Cap/blob/main/crates/rendering/src/zoom_spring.rs) considers content coordinates, comfort zones and tests for abrupt automation movements.
- [Chromium: PageHandler](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/page_handler.cc) captures the compositor's physical surface. Changing only the emulated DPR does not guarantee a Retina screencast. This was reproduced and verified on this machine.
- [FFmpeg: scale](https://ffmpeg.org/ffmpeg-filters.html#scale-1) allows controlling matrix and range in the RGB → YUV conversion. The file now also declares primaries and transfer.

## Gaps fixed

| Identified gap | Implementation | Expected effect / verification |
| --- | --- | --- |
| 1× capture and JPEG before upscaling | Lossless PNG, `captureScale: 2`, Chromium physical scale and emulation aligned | Real 2880×1800 frames keeping a 1440×900 layout; resolution checked on every frame |
| Page scaled down to the frame and scaled up again | Final transform applied directly to the source image | Test with one-pixel lines preserves contrast in 1:1 mapping |
| Cubic filter smoothed even without upscaling | Filtering chosen by the source/output pixel ratio | Cubic only for upscaling; keeps detail when the capture already has enough resolution |
| Repeated rendering of a static page during cursor movement | Page cache at the final resolution, independent of the cursor overlay | Reuse without upscaling an intermediate bitmap; maximum tolerance of 0.01 pixel in the spring tail |
| Camera pointed at stale coordinates during scroll | Scroll events interrupt focus and linking between groups | Early pull-back, next focus only after settling/visibility; fallback for old sessions |
| Nearby clicks shared zoom but changed center | Combined region when the controls fit in the comfort zone | Stable framing that preserves context; test covers the whole group region |
| Click circle followed the mouse | Indicator anchored at the click coordinate | The clicked spot stays identifiable while the mouse moves away |
| Single arrow over fields and links | DOM metadata, vector arrow/hand/I-beam, 80 ms transition and filter for brief events | More coherent cursor; old sessions keep using the arrow |
| Second click animation to type in an already focused field | `type` checks the active element | Avoids a redundant click and keeps typing visible |
| Trajectories accumulated late steps | Scheduling by real time, dropping stale samples, and duration based on distance/target size | Avoids bursts to catch up with browser lag |
| Scroll always had 60 increments | Scheduling by duration and real time | Long scroll no longer has its cadence limited to 60 total increments; does not guarantee 60 source frames |
| Autoscroll always waited 350 ms | Waits for the rectangle to settle in the browser, with a time limit | Next movement uses the target's settled position |
| Typing had a mechanical five-key cycle | Deterministic per-character variation, small pauses between words and after punctuation | Reproducible rhythm with less noticeable repetition |
| Waits changed speed instantly | Ramps with continuous speed/acceleration, 550 ms edges and 4× maximum | Numeric tests check monotonicity, limits and smooth joins |
| Waiting for the next target was not considered | Compression of long preparation when there are timestamps and no protected movement | Reduces idle time without compressing clicks, mouse or scroll |
| Delivery quality was fixed at CRF 18 | `--quality high` default: CRF 16, preset medium and up to eight samples (16 since the [second pass](motion-review.md#second-pass-video-finish-measured)); `standard`: CRF 18 and five | More headroom for text/gradients; higher CPU cost and file size |
| Colors depended on implicit conversion | BT.709 matrix/primaries, limited range and sRGB transfer declared | Declared conversion for the sRGB source, verifiable with ffprobe. On FFmpeg 7.1+ the primaries and transfer were dropped until 2026-09-26; now the `setparams` filter writes them ([second pass](motion-review.md#second-pass-video-finish-measured)) |

## Choices kept

A critically damped 5.8/s spring, moderate zoom and release after 2.4 s of inactivity remain the baseline. The review does not globally increase the speed or intensity of the effects. Wallpaper, padding and window remain a single scene and can show naturally during zoom. Explicit editorial pauses and manual focuses are respected. The source stays reusable; `--pacing original` keeps its duration.

## Limits and next investments

1. **Real page cadence:** CDP delivers frames according to the compositor, load and encoding. Exporting at 60 fps smooths camera/cursor but does not create new frames for scroll and app animations. A dedicated GPU/compositor capture with timestamps needs another backend and a benchmark; duplicating frames does not solve this limit.
2. **Semantic context:** focus considers rectangles and compact containers. It does not interpret the meaning of charts, results or route changes. The script still needs to pick suitable selectors/results and `focus` for editorial reading.
3. **Special cursors:** canvas, iframes and custom pointers are not fully detected. The current vectors represent three shapes, not official reproductions of the full macOS cursor set.
4. **Legibility of old captures:** re-exporting improves composition and camera but does not recover resolution already lost in old JPEGs. `sourcePixelsPerOutputPixelAtMaxZoom` below 1 indicates pixel upscaling.
5. **Export time:** Retina PNG and more samples cost CPU. Measure with the session's `render.json`; numbers from old versions do not guarantee current performance. Hardware acceleration should be evaluated by comparing text quality, not just speed.

## Verification

`npm test` covers behavior and regressions, including geometry, time ramps, pixel detail and cursor transitions. `npm run check` checks syntax. The long demo exercises 38 steps, with forms, menus, scroll, a report and async results. Frames from the new capture were checked at a physical resolution of 2880×1800. The visual conclusion and export numbers are in `recordings/extended-demo-20260915-retina/`.

Tests and metadata do not demonstrate visual equivalence to Screen Studio nor guarantee subjective comfort for every script.
