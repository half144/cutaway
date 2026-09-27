# Motion and finish review — 2026-09-26

Goal: videos with Screen Studio's finish, where the cursor, pacing and camera feel like a calm presenter and not a script. The values below come from three sources: Screen Studio's documentation and demos, the code of open-source editors that state they imitate the same semantics, and research on motor control and typing. No code or assets were copied.

## Diagnosis of the previous version (measured)

Measurements taken on the `extended-demo-20260915-retina` timeline (38 steps), using the same camera logic:

- **Pumping:** the zoom went out and came back in under 1.8 s at 6 moments, and 3 returns to the overview lasted 0.4–0.8 s. The cause was `scrollIntoView({ block: 'nearest' })`, which left each target stuck to the edge and forced a new scroll at every step, combined with a bridge of only 1 s between focuses.
- **Auto-scroll:** Chromium's native `smooth` scroll lasted 0.32–0.38 s (√Δ/60) and was captured in 4–8 frames.
- **Missing zoom:** 7 of 30 focuses ended at 1.0×, including 6.5 s of typing in a 1029 px textarea and 6 of 10 manual `focus` steps.
- **Camera bounds:** they were computed in viewport units, which removed the travel needed to center the target. In close-ups near the edge, ~250 px of wallpaper (13% of the frame) was left over while useful content was cut off on the other side.
- **Invisible click:** the white ring at 22% opacity did not show on light pages.
- **Cursor over the text:** the I-beam sat on top of the text being typed.
- **Typing too fast:** 10–12.7 characters/s (~150 WPM).
- **Slow render:** 4.1 fps at 1080p. Each motion blur sample redid the resample of the 5 MP capture (39 ms in `high`, 11 ms in `medium`).

## References

- **Screen Studio.** The cursor demo on the site, which according to the author behaves like the app at default settings, uses a 470/70/3 spring, click at 0.8×, rotation of vx/240 degrees and shape change with scale from 0.6 to 1 in 0.2 s. In the official auto-zoom video, the zoom starts abruptly, is almost complete in 0.6–0.7 s and shows the wallpaper near the edges. Shortcuts appear in a dark pill and single keys are hidden by default ([shortcuts guide](https://screen.studio/guide/shortcuts), [animations](https://screen.studio/guide/animations)).
- **Cap** (`crates/rendering`, which cites Screen Studio's semantics). 2× auto-zoom, starting 300 ms before the click, holding 2.5 s after and merging intervals up to 2.5 s apart. The cursor shrinks to 0.8 over 130 ms before the click. The idle fade takes 400 ms, with the cursor reappearing 250 ms before movement resumes.
- **openscreen and Recordly.** The curve `easeOutScreenStudio = cubic-bezier(0.16, 1, 0.3, 1)`, default zoom of 1.8×, and pan instead of zoom-out when the interval is shorter than ~1.5 s.
- **Motor control.** Fitts's law for the mouse with a ≈ 0.1 s and b ≈ 0.2 s/bit ([Buxton](https://www.billbuxton.com/fitts91.html), [Soukoreff and MacKenzie](https://www.yorku.ca/mack/ijhcs2004.pdf)). The deceleration phase takes 55–70% of the time. The main movement stops at ~94% of the path and is completed by a correction. Typical lateral deviation is ~3% of the distance ([MacKenzie et al. 2001](https://www.yorku.ca/mack/CHI01.htm)). The button stays pressed for 100–120 ms.
- **Typing and reading.** Fast typists have an inter-key interval of ~120 ms and the first key of each word is slower ([Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)). In subtitles, comfortable reading is 0.3–0.375 s per word ([BBC](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/)).

## Decisions

| Aspect | Before | Now | Why |
| --- | --- | --- | --- |
| Zoom | Window per focus; level 1.45–1.75× depending on the action | Shots: actions up to 3.5 s apart merged, constant level of 1.8×, 2.5 s after the click, pan linking for intervals < 2 s, shots < 0.9 s dropped | Follows the semantics of Cap and Screen Studio; a constant level avoids a "breathing" zoom |
| Purposeful zoom | Continuous close-up on any sequence of actions (86% of the dashboard demo zoomed in, 80% at ≥ 1.6×), level 1.8×, 2.5 s after the click | The capture records the area that changed after each click; if the effect fills the screen, the click happens in the overview. Default level 1.5×; zoom held 1.8 s after the click and 1.2 s after typing; merging up to 3 s; linking < 1.5 s | The user found the zoom too strong and too long. On the dashboard: 48% zoomed in, peak 1.5×, shortest return to the overview 2.8 s (was 1.4 s) |
| Pacing | Movements 0.16 + 0.17·ID; waiting for animations up to 0.9 s; fixed pauses; reading 0.3 s per word up to 2.4 s; typing ~100 WPM | Movements 0.12 + 0.14·ID (floor D/1100 s); waiting up to 0.6 s; pauses with ±30% variation; reading 0.6 s + 0.15 s per word up to 1.6 s; ~110 WPM | The user found some actions slow and the pacing robotic. On the dashboard: average movement from 0.80 to 0.68 s; average action from 2.34 to 2.11 s; longest pause from 2.4 to 1.6 s |
| Opening | A `focus` at the start zoomed in on its own at ~1 s, before any action | The video opens on the whole page; a `focus` before the first gesture is ignored and the first zoom starts with the first mouse movement | Zoom with no visible cause at the start felt random |
| Camera and cursor sync | Camera scheduled by the cursor's arrival (0.4 s before); following only from 84% of the view | The camera starts together with the cursor and follows it in the central 60%; a zoom-out that ends up to 1 s before a cursor departure now happens together with it | In the long demo, the idle cursor was dragged 153 px on average (and left the frame in 5 gestures). Now it is 78 px. Framing changes requested by the script hide the idle cursor (see the second pass) |
| Camera spring | One critical spring of ω = 5.8 (initial jolt, 90% in 0.67 s) | Cascade of ω = 30 and 7.2 on a logarithmic scale, 1/240 s sub-steps | Same exit curve as the official video (90% in ~0.6 s, tail up to ~1.2 s), without the acceleration jump on the first frame |
| Framing | Bounds in viewport units | Bounds in the scene with a margin; wallpaper limited to the padding and to ~10% of the view; pre-aim at 1× and zoom-out from the same framing | Screen Studio's behavior, with enough travel to center the target |
| Results | `expect` only waited for the element | Frames the result together with the control, moves to it, or shows it in the overview if it is large | The camera goes where the change happens |
| Wide fields | No zoom | Frames the start of the field and follows the caret | Typing is where zoom matters most |
| Tall or wide `focus` | Ignored | Tall: fitted by width and read from the top. Too wide: holds the overview during the focus, with no shots on top | Six of ten focuses in the demo did nothing |
| Auto-scroll | Native `scrollIntoView`, target at the edge | Custom glide (0.45 s + √Δ/45 s), target at 45% of the height (tall targets: from the top), together with the next target when it fits; fixed elements do not scroll the page | Fewer scrolls, no jumps, target with context |
| Trajectory | Bézier with random side, peak at 50%, lateral deviation at the end | Consistent arc (3–6%), peak at ~42%, landing at ~96% and correction along the path | Human aiming movement, without the wobble of anti-bot libraries |
| Movement duration | 0.18 + 0.16·ID | 0.16 + 0.17·ID, with a floor of D/850 s | Presenter's Fitts; readable peak speed |
| Click | White ring; button pressed 70 ms | Shrinks to 0.8× before mouse-down; button pressed 95–125 ms; no ring | Screen Studio and Cap default; works on any background |
| Cursor | 1.45; shape change in 80 ms; visible while typing | 2.0 and grows with √zoom; crossfade with 0.2 s scale; hides while typing; rotation of vx/240 degrees | Screen Studio and macOS size and behavior |
| Typing | ~150 WPM with a pseudo-random cycle | Lognormal ~100 WPM, first key of the word ×1.35, +260 ms after a comma and +480 ms after a period | Too fast looks like autocomplete |
| Pacing | Fixed pauses of 0.3–0.55 s | Waits for animations and DOM changes (≤ 0.9 s) before the pause; `expect` on screen for 0.5 s + 0.3 s per word; 0.9 s opening | Subtitle reading time |
| Composition | Plain frame; 16:10 viewport | Vector browser bar, three-layer shadow, thin border; default viewport 1440×810 | Looks like a real window, with even margins in 16:9 |
| Keys | Invisible | Pill with modifier combinations (`--keys`) | Shortcuts with no visible cause are confusing |
| Render | Full resample per blur sample; full-screen overlay | One raster per frame, samples via affine transform, compositing only in the cursor area | 11.9 fps at 1080p (was 4.1–4.6) |

## Second pass: video finish (measured)

Measurements on the `polish-20260926-final` (38 steps, 123 s) and `polish-20260926-demo` (13 s) captures, with the camera and cursor simulated exactly as in the render and pixels compared numerically. No frame was judged by eye.

| Aspect | Before | Now | Measurement (before → now) |
| --- | --- | --- | --- |
| Idle cursor dragged by the camera | A `focus` right after a click or the zoom-out from a large result carried the idle cursor across the screen, sometimes out of the frame | The camera is simulated before the cursor. When a movement that starts with the hand still would carry the cursor more than 1/16 of the frame width (120 px at 1080p) or out of it, the cursor shrinks and hides 0.1 s before and returns 250 ms before the hand moves, as in Cap. The camera settling right after a gesture stays visible | Total visible drag: 2988 → 510 px (long) and 1862 → 68 px (short). Worst episode: 1127 → 151 px and 1857 → 63 px. Visible cursor carried out of the frame: 1.88 → 0 s and 1.33 → 0 s. Across the 21 clicks, the cursor stays 100% visible |
| Showing and hiding | Reactive exponential smoothing: 28% of the opacity disappears on the first frame; idle at 2.5 s even if the hand was about to move 0.1 s later | Intervals computed ahead of time and eased fades (0.18 s to hide, 0.2 s to return). Hides shorter than 0.5 s are skipped. A cursor that would hide before the first movement does not appear in the opening | Largest per-frame change: 0.283 → 0.138. Blinks (hide and return in < 0.8 s): 1 → 0 |
| Revealed result and `focus` on it | 1.8× → overview for 2.1 s → 1.18× on the same content (71–73 s) | If the next shot starts within 3.5 s and shows at least half of the revealed result, the camera goes straight from the close-up to it | Round trips to 1× zoom (drop > 0.3 followed by zooming in again within 3 s): 3 → 2. The two remaining ones are intentional: a `wait` step and a `focus` too large to zoom into |
| End of the video | Duration = release of the last shot + 1.1 s; the zoom-out takes ~1.5 s to settle | Release + 1.5 s to settle + 1 s still on the overview | Still time at the end (camera < 2 px/s): 0.45 → 0.98 s and 0.43 → 0.98 s. In the decoded MP4: 0.52 → 1.05 s and 0.48 → 1.03 s. The opening already had ~1 s with no pixel change and the first two captured frames are identical |
| Motion blur | Up to 8 samples; zoom was measured as Δzoom × width, twice the real displacement | Up to 16 samples, spaced at most ~2 px apart, using the real displacement (pan + zoom reach at the corners) | Frames with samples more than 2 px apart: 427 → 42. Largest spacing: 4.45 → 2.23 px. In the three fastest segments measured, edge PSNR against 48 samples rose from 34.6–38.1 to 39.5–40.3 dB. Cost: +8.5% samples; in a 32 s segment with only fast pans, the render was ~8% slower (average of 4 runs) |
| Colors | The file came out as 2-2-1 (primaries and transfer "unspecified"), with no `colr` atom. QuickTime interprets this as BT.709 and shows the capture lighter | Tags 1-13-1 (BT.709 primaries and matrix, sRGB transfer, limited range) written with `setparams` into the H.264 VUI and the `colr nclx` atom | Error in flat areas after decoding with limited BT.709: 0.355 level (average), equal to the floor of uncompressed YUV 4:2:0 conversion (0.343). See below |

**Colors.** Chromium's capture is sRGB. AVFoundation decodes BT.709 and untagged video with gamma ≈ 1.96: an sRGB gray of 126 shows as 137. With transfer 13 (IEC 61966-2-1), it uses the sRGB curve and shows 126 ([Apple TN2227](https://developer.apple.com/library/archive/technotes/tn2227/_index.html), [kCVImageBufferTransferFunction_sRGB](https://developer.apple.com/documentation/corevideo/kcvimagebuffertransferfunction_srgb), [analysis of the QuickTime gamma shift](https://blog.dominey.photography/2021/01/24/why-are-videos-washed-out-on-the-mac-exploring-quicktime-gamma-shift/)). Chrome applies the sRGB curve for both BT.709 and sRGB ([color_space.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/gfx/color_space.cc)). Firefox treats BT.709 as sRGB by default (`gfx.color_management.rec709_gamma_as_srgb`, [StaticPrefList](https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml)). The ASWF guidelines recommend `iec61966-2-1` as the most reliable option for the web and advise against gamma 2.2 in Safari ([Web Color Preservation](https://academysoftwarefoundation.github.io/EncodingGuidelines/WebColorPreservation.html)). The value codes are in [ITU-T H.273](https://www.itu.int/rec/T-REC-H.273). The encoder already passed `-color_trc iec61966-2-1`, but since FFmpeg 7.1 the tags come from the filtered frames and those options are dropped ([commit 9a7686e](https://github.com/FFmpeg/FFmpeg/commit/9a7686e5458dad8d40b3b3f70f6a19530933468e)). That is why the [`setparams`](https://ffmpeg.org/ffmpeg-filters.html#setparams) filter writes them. With all three tags set, the MP4 muxer writes the `colr` on its own. A test now checks the tags and the decoded colors.

The encoder's RGB → YUV conversion matches the BT.709 formula for white, black, gray and interface colors. A measurement trap: swscale's default YUV → RGB conversion rounds down (white becomes 253). To measure colors, decode with `flags=accurate_rnd+full_chroma_int`.

**Encoding.** SSIM, PSNR and edge sharpness (PSNR on text pixels only and fraction of the gradient preserved) were measured on 594 frames: typing at 1.8×, fast pan, overview with small text and zoom-out. The reference is the lossless composited frames, converted to YUV 4:2:0 the same way:

| Configuration | PSNR-Y (dB) | SSIM-Y | Edge PSNR (dB) | kbps |
| --- | --- | --- | --- | --- |
| medium, CRF 16 (default) | 53.06 | 0.99854 | 40.63 | 1571 |
| slow, CRF 16 | 53.25 | 0.99863 | 40.79 | 1587 |
| medium, CRF 14 | 54.65 | 0.99896 | 42.30 | 1963 |
| medium, CRF 16, `aq-mode=3` | 54.68 | 0.99878 | 42.78 | 2012 |
| medium, CRF 16, `-tune animation` | 53.30 | 0.99831 | 41.36 | 1576 |
| medium, CRF 16, `-tune stillimage` | 51.90 | 0.99840 | 39.11 | 2118 |
| medium, CRF 16, `deblock=-1,-1` | 53.02 | 0.99853 | 40.64 | 1567 |
| medium, CRF 12 | 56.31 | 0.99928 | 43.97 | 2466 |

The default stays: the worst frame is at 46.9 dB and the median at 53.4 dB, already in the transparent range. `slow` gains 0.2 dB and costs ~35% more CPU. CRF 14 and `aq-mode=3` gain ~1.6 dB with 25–28% more file size; at the same bitrate, `aq-mode=3` performs the same as CRF 14. `stillimage` makes edges worse. `animation` trades SSIM for edge PSNR. In RGB, with chroma included, edges are at 36.0 dB, against 40.1 dB for uncompressed 4:2:0: `chroma-qp-offset=-4` adds 0.4 dB with 6% more file size, and CRF 14 adds 0.9 dB with 25%. None of these trade-offs justified changing the default. 4:4:4 was left out for compatibility: the H.264 High 4:4:4 profile is not guaranteed to be supported in QuickTime and Safari.

**Rejected.** Compensating for scroll between captured frames using CDP's `scrollOffsetY`. Without separate layers, fixed or sticky elements would shift along with the page; deterministic capture remains the safe path. Also rejected: lowering the drag threshold to hide the cursor on every zoom-out. The settling right after a gesture reaches 54 px and should stay visible, as in Screen Studio.

## Limits

- **Capture cadence:** still the main limit. The CDP screencast delivers ~25–40 fps during scroll, regardless of PNG or JPEG and of when the ack is sent, and exporting at 60 fps does not create page frames. A deterministic capture with BeginFrame and virtual time would solve it, but requires rewriting the capture. `render.json` shows `sourceFpsDuringScroll`.
- **Old recordings:** re-exporting applies camera, cursor, click and composition. The new caret, `expect` results, keys, typing and auto-scroll only exist in new captures.
- **Test scope:** the tests guarantee continuity, limits and timings; they do not replace watching the video.

## Third pass: human pacing (2026-09-26)

An agent watched the videos frame by frame, measured what felt robotic and compared it with Cap, Screenize, Recordly, capptivo and the openscreen forks (code in `/tmp/as-oss`). Measurements on the dashboard demo (`web-dashboard`), v2 → v3:

| Observed problem | Change | Measured result |
| --- | --- | --- |
| Cursor frozen 69% of its visible time; every gesture was "still → stroke → still" | The hand relaxes 8–16 px inside the control after the click; during pauses, it starts slowly (≤ 250 px/s) toward the next visible target; slight drift during long rests. No random tremor (ghost-cursor does that to avoid bot detection, wrong for a demo) | Frozen 69% → 58%; longest stretch 3.7 → 1.7 s (the rest is auto-scroll, when a person also keeps the mouse still) |
| Metronome micro-timings (arrival → click 0.14–0.21 s; click → key always 0.25 s) | Lognormal wait before the click (median 0.12 s), +0.05 s per bit above 3, +0.15 s before save/delete/confirm; lognormal button ~105 ms; hand to the keyboard 0.25–0.45 s; field selected for ~0.2 s and overwritten; lognormal typing (median 90 ms, σ 0.42), ×1.5 at the start of a word, 4% hesitations | Click → key 0.29 s (CV 8%) → 0.47 s (CV 20%) |
| Dead time: panel open and still for 1.6 s, 3.5 s tail, 28% static stretches in the long demo | Compression of static stretches > 1.1 s (0.35 s edge, middle 3.5×), ignoring imperceptible repaints (threshold on a 192×108 thumbnail); reading based on the result's title; short pause when the next step acts inside the result; ending 1.2 + 0.4 s | Static stretches ≥ 0.8 s: 32% → 15% of the video |
| Camera ~0.4 s behind the mouse after an overview | The overview of a large effect ends when the hand starts moving again | 0 s lag in every shot |
| Camera movements all with the same duration | The main spring varies 0.8–1.5× depending on the time until the next change (Screenize, `AdaptiveResponse.swift`) | Varied durations; the final zoom-out keeps the normal pace so the video ends still |
| Zoom back and forth between nearby close-ups | Between close-ups up to 2.5 s apart on nearby subjects, pulls back only halfway (Screenize `WaypointGenerator.swift`) | No return to 1× followed by a new zoom in < 2.5 s |
| Tilt at the 10° limit on every long stroke | 1° per 480 px/s, up to 8° (Cap gives ~4.5°) | — |
| Long click squeeze when the page is busy | Squeeze limited to 0.14 s and release with a slight bounce (1.04×) | — |
| Cursor hidden for up to 12 s; Esc clearing the field with no visible cause | Hides only after 3.5 s still, never during scroll; keys do not hide the cursor; Esc/Enter/Tab show in the pill | — |
| Opening with an entry animation and a tooltip under the cursor | Waits for the page to settle (up to 3 s, 0.4 s of quiet) and parks the cursor on a spot with no hover | Identical first frames (Δ 0.02) |
| Slow stroke at the end ("creep") | Final correction only for targets < 24 px, ≤ 120 ms | Slow tail ≤ 0.16 s on large targets |

Revised at the user's request ("the mouse movement doesn't feel natural"): the drift after the click and the slow advance during the pause turned into a mechanical tic and a two-step movement (drift, stop, advance, stop, stroke). They were replaced by a single stroke to the next target during the pause, with the hand waiting on it; the camera starts with that stroke (`approachStart`). On the dashboard: no movement < 40 px and no stroke chained into another.

Revised again ("movement too linear, not smooth"): strokes deviated only 1.4–2.6% from the straight line and the cursor was drawn exactly on the stroke. Now the arc reaches 4–7% of the distance, and the cursor goes through the Screen Studio spring (470/70/3, chasing a point 60 ms ahead) and is pinned to the exact point on each click. On the dashboard: arcs of 3.7–6.1%, abrupt cursor acceleration at 65% of the raw stroke's, clicks 0.0 px from the target. If the layout changes after a stroke made during the pause, the click happens where the hand is, with no second correction stroke.

Rejected: the medium shot (1.25×) for large effects suggested by the reviewer left the video zoomed in 86% of the time, against the user's request for less zoom; it was removed.
