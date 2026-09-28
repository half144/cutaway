---
name: cutaway
description: Record polished browser workflow demos with animated zoom, a smooth cursor, motion blur, and local MP4 export, or framed screenshots of a page area without video. Use for web UI demos, tutorials and still evidence for cards or PRs in one Chromium tab.
---

# Cutaway

Turn the requested workflow into one JSON plan, then capture and export it with the bundled CLI. The CLI controls Playwright; no additional model or video service is needed.

## Fast path

1. Reuse the current conversation: app URL, running dev server, implemented feature, selectors, tests and known success state. If these are already known, write the plan directly. Otherwise inspect only the route or controls needed for this recording, using existing tests/source or a targeted browser inspection. Do not perform a fresh project audit, whole-repository search, build, or full test suite just to record a demo. Start the app only if it is not already available.
2. Write a short plan for the requested outcome. Prefer stable test IDs, IDs or input names already verified in code/UI. Include necessary navigation and a visible success indicator. Avoid rehearsing the entire workflow before recording when the available context is sufficient. Avoid fixed waits when `expect` can wait for the actual result; leave `pause` unset unless extra reading time is useful.
3. Run the command below once. It checks dependencies automatically before browser actions, captures, and exports the final video. Do not run a preview followed by a final export by default.
4. Review the exported video or representative frames at interactions, zoom transitions and the final result. If the result is correct, deliver it. Re-render only for a concrete visual defect or a requested variant; re-record only for an actual capture/action problem and when replay is authorized.

Use `scripts/run.mjs` next to this skill, with its absolute path. It resolves the linked repository automatically; the working directory can remain the user's application. Use absolute plan/output paths. Do not copy the skill scripts into the target project or reimplement the recorder.

```sh
node <skill-directory>/scripts/run.mjs record /absolute/plan.json --out /absolute/new-recording
```

Default output is **1920×1080 at 60 fps**: the Sonoma Horizon wallpaper (after `npm run wallpapers`; the bundled macOS wallpaper otherwise), a browser window with traffic lights and address bar, Screen Studio-style zoom shots at 1.5×, a human-paced cursor and temporal motion blur. New captures use lossless PNG at 2× physical resolution and high-quality H.264 export (`--quality high`, CRF 16). Keep this quality for showcase videos. For PR evidence, bug repros and quick previews, add `--width 1280 --height 720 --quality standard`: it stays legible in GitHub's player, exports about 3× faster (~0.7 s per second of video on an Apple M4, against ~1.8 s at the default) and keeps ~30 s of video under the 10 MB attachment limit on free plans. Export already uses up to half the CPU cores in parallel processes, so run one export at a time.

## Plan

```json
{
  "url": "http://localhost:3000/projects",
  "steps": [
    { "action": "click", "selector": "[data-testid=edit-project]" },
    { "action": "type", "selector": "input[name=title]", "text": "Website atualizado" },
    { "action": "click", "selector": "button[type=submit]", "expect": "[data-testid=saved]" },
    { "action": "focus", "selector": "[data-testid=project-title]", "duration": 1 }
  ]
}
```

Selectors are Playwright locators: CSS plus `role=textbox[name="Email"]`, `:has-text("Continue")` and `:text-is("Skip")`, which help when the app has no test IDs. Each must match exactly one element. The example selectors are placeholders for your app, not selectors to guess. `expect` must identify the actual result, not an always-visible empty container. Default capture scale: 2× (2880×1620 source pixels at the default viewport). Set `captureScale: 3` in the plan for a 4K delivery when useful; source dimensions must remain at most 8192 pixels. Default viewport: 1440×810 (16:9, matching the export); override with `viewport` only when the app needs a different size. `hide` at the plan root takes CSS selectors (not Playwright ones) removed from every frame, such as `["nextjs-portal"]` for the Next.js dev tools badge on a dev server.

Actions: `click`; `type` (replaces text with visible typing); `focus` (frames a visible element without clicking); `scroll` (`y` relative pixels, optional `duration`); `press` (`key`, e.g. `Enter`); `wait` (`duration` seconds); `upload` (`selector` of the button that opens the file chooser, `file` as a path or array of paths relative to the plan: the click is shown, no native dialog opens and the files go straight to the page). Each step accepts `pause` and `expect` (visible selector). Leave `pause` unset for adaptive human pacing: after clicks and keys the capture waits for animations to settle, and an `expect` result stays on screen long enough to register (0.6 s + 0.15 s per word, 0.8–1.6 s). Pauses vary slightly, like a person's. Set `pause` only when the content needs a deliberate editorial hold. Give important steps an `expect`: the camera frames that result with the clicked control, or moves to it. `timeout` at the plan root sets action timeout in milliseconds (default 10000, maximum 120000). Use a larger `focus` container when surrounding context matters; tall regions are framed from the top. A short closing hold and zoom-out are already included. Zoom is for local detail: a click whose effect fills the screen (a chart redraw, a panel opening) plays out on the overview, while typing, menus and small effects get a close-up. Local actions less than ~3 s apart share one continuous close-up, which holds 1.8 s after the last click, even during a network wait, so use explicit `focus` when the user needs a longer one. Manual `scroll` ends a close-up; automatic scrolling to the next target does not, and it brings the next step's target into view too. Typing into wide fields follows the caret. Shortcuts with modifiers (`press` with `ControlOrMeta+K`) and named keys that change the page (Escape, Enter, Tab) are shown on screen; plain character keys are not. The recorder adds human timing on its own (varied pauses, and the pointer moving to the next visible target in one stroke while the viewer reads), and balanced pacing trims dead time where nothing on screen changes, so don't pad plans with extra `wait` steps. Do not add a click immediately before `type` just to focus that same field. Rendering uses balanced pacing with continuous speed ramps (up to 4×) to shorten only long inactive waits while preserving their start and end at real speed; pass `--pacing original` when captured duration must remain exact.

## Snapshots (still evidence, no video)

When a still is enough (card or ticket evidence, a PR picture of a result), add `snapshot` steps and run `snap` instead of `record`:

```sh
node <skill-directory>/scripts/run.mjs snap /absolute/plan.json --out /absolute/new-directory
```

`{ "action": "snapshot", "selector": "#result", "name": "saved" }` saves `snapshots/saved.png`: the element plus a 16 px margin, framed in the browser window on the wallpaper, at 2×. Leave out `selector` for the whole viewport; `name` (letters, digits, `_`, `-`) defaults to `step-N`. Put the snapshot after the step whose `expect` shows the result, so the state is settled. `snap` records no video and needs no FFmpeg; the result JSON lists `snapshots`. `render <directory> --preset <name>` or `--window none` frames them again without repeating the steps. `record` also saves snapshots in its plan. Deliver the framed PNGs with their absolute paths.

## Phones

When the user asks for a mobile, phone or vertical recording, add `"device": "iPhone 15 Pro"` (or another phone from Playwright's device list, such as `"Pixel 7"`) at the plan root and leave out `viewport`. The page runs in Chromium at the phone's size with touch input and a mobile user agent. Write `tap` and `swipe` (`y` pixels) for `click` and `scroll`; `hold` seconds on a tap makes a long press. Pick selectors from the app's mobile layout (a bottom tab bar or a menu button instead of a desktop sidebar). The export defaults to a 1080×1920 video with a drawn phone, a status bar, white touch indicators instead of a cursor and an on-screen keyboard while typing; a close-up fills the width with the screen and only pans vertically. For a feed post pass `--width 1080 --height 1350`; for a landscape video with the phone centered, `--width 1920 --height 1080`; for PR evidence, `--width 720 --height 1280 --quality standard`. The timeline keeps typed characters (not password fields) to draw the keyboard.

## Setup and recovery — only when needed

Normal recordings include preflight; a separate doctor call is optional, useful on a new machine or to diagnose setup:

```sh
node <skill-directory>/scripts/run.mjs doctor
node <skill-directory>/scripts/run.mjs validate /absolute/plan.json
```

`doctor` returns readiness, the actual tool repository, and fixes for missing dependencies. It does not launch a browser, install packages or change the app. Install only missing requirements, in the tool repository reported by doctor: `npm ci` for missing packages, `npx playwright install chromium` for the missing browser. FFmpeg comes with `npm ci`; FFmpeg with libx264 on PATH is the fallback when that download fails. Do not reinstall dependencies on each invocation. `validate` checks JSON/schema only; it does not verify selectors or page state and is optional for unfamiliar plans.

Capture and render are independent. If export fails after a successful capture, use the saved session instead of replaying actions:

```sh
node <skill-directory>/scripts/run.mjs render /absolute/recording
```

For visual tuning, render accepts `--zoom 2`, `--blur 0.5`, `--cursor-size 2`, `--padding 0.09`, `--preset macos|dusk|midnight|pearl|<wallpaper>` (macOS wallpapers such as `tahoe-day` or `sonoma-horizon` after `npm run wallpapers` in the tool repository; an unknown name lists the available ones), `--window browser|device|none`, `--keys combos|all|none`, `--width`, `--height`, `--fps`, `--quality high|standard`, and `--output`. `--zoom 1` or `--blur 0` disables that effect. `render.json` → `motion` reports shots, the shortest close-up and the shortest return to the overview; a return under ~1 s means zoom pumping worth fixing in the plan. Wallpaper, padding, browser and cursor form one scene; wallpaper may naturally remain visible during zoom. Do not fix that by removing padding or clamping the composition.

`record --capture-only` defers export. `--headed` shows Chromium. `--storage-state /absolute/session.auth.json` loads an existing authorized Playwright session into a new context. Existing browser sessions are not attached automatically. Use a fresh output directory per capture. Do not rerecord into a directory containing frames.

## Scope and delivery

Prefer a local/test instance and demo data. A local frontend is not a test backend: before recording a step that saves data, check where the app's API or database environment points, since a dev server wired to production writes to production. Capture replays actions: recording permission does not authorize sending messages, publishing, or other consequential production changes. Preserve the requested flow and existing authorization. Do not repeat a production submission just to rehearse it.

Deliver the MP4 inline when supported, with its absolute path. The CLI reports phases on stderr, ending with `Video ready: <path>`, and the result as JSON on stdout (`output` is the video path). `workflow.json` separates preflight, browser setup, recording and export timing; browser setup is included in recording time. It does not measure the agent's earlier discovery/planning time. If the user reports slowness before capture, inspect that preparation rather than attributing it to rendering. `render.json` records export performance, and `timeline.json` records action timing and status. No extra benchmark is needed for ordinary delivery.

Only one Chromium tab is supported; no native windows, audio, webcam or popups; file choosers are answered by `upload`. Source frames follow browser compositor cadence; 60 fps export does not guarantee 60 distinct source frames. Visible page content is captured, including typed text. Never claim Screen Studio parity or visual perfection from unit tests or a poster alone.
