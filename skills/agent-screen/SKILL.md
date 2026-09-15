---
name: agent-screen
description: Record polished browser workflow demos with animated zoom, a smooth cursor, motion blur, and local MP4 export. Use for web UI demos and tutorials in one Chromium tab.
---

# Agent Screen

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

Default output is **1920×1080 at 60 fps**, macOS wallpaper, smooth cursor and adaptive zoom up to 1.8× with temporal motion blur. New captures use lossless PNG at 2× physical resolution and high-quality H.264 export (`--quality high`, CRF 16). Keep this quality for normal delivery. If the user requests a quick preview, add `--width 1280 --height 720`; do not silently reduce quality to make a final export faster.

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

Selectors must match exactly one element. The example selectors are placeholders for your app, not selectors to guess. `expect` must identify the actual result, not an always-visible empty container. Default capture scale: 2× (2880×1800 source pixels at the default viewport). Set `captureScale: 3` in the plan for a 4K delivery when useful; source dimensions must remain at most 8192 pixels. Default viewport: 1440×900; override with `viewport: { "width": 1440, "height": 900 }` when needed.

Actions: `click`; `type` (replaces text with visible typing); `focus` (frames a visible element without clicking); `scroll` (`y` relative pixels, optional `duration`); `press` (`key`, e.g. `Enter`); `wait` (`duration` seconds). Each step accepts `pause` and `expect` (visible selector). Leave `pause` unset for adaptive human pacing; set it only when the content needs a deliberate editorial hold. `timeout` at the plan root sets action timeout in milliseconds (default 10000, maximum 120000). Use a larger `focus` container when surrounding context matters. A short closing hold and zoom-out are already included. Automatic click focus releases after 2.4 seconds without activity, even during a network wait; use explicit `focus` when the user needs a longer close-up. Cursor shapes follow text and pointer controls, without rapid type flicker. Related controls share stable framing; scrolls release stale zoom targets. Do not add a click immediately before `type` just to focus that same field. Rendering uses balanced pacing with continuous speed ramps (up to 4×) to shorten only long inactive waits while preserving their start and end at real speed; pass `--pacing original` when captured duration must remain exact.

## Setup and recovery — only when needed

Normal recordings include preflight; a separate doctor call is optional, useful on a new machine or to diagnose setup:

```sh
node <skill-directory>/scripts/run.mjs doctor
node <skill-directory>/scripts/run.mjs validate /absolute/plan.json
```

`doctor` returns readiness, the actual tool repository, and fixes for missing dependencies. It does not launch a browser, install packages or change the app. Install only missing requirements, in the tool repository reported by doctor: `npm ci` for missing packages, `npx playwright install chromium` for the missing browser; FFmpeg with libx264 must be on PATH. Do not reinstall dependencies on each invocation. `validate` checks JSON/schema only; it does not verify selectors or page state and is optional for unfamiliar plans.

Capture and render are independent. If export fails after a successful capture, use the saved session instead of replaying actions:

```sh
node <skill-directory>/scripts/run.mjs render /absolute/recording
```

For visual tuning, render accepts `--zoom 1.65`, `--blur 0.5`, `--cursor-size 1.45`, `--padding 0.09`, `--preset macos|dusk|midnight|pearl`, `--width`, `--height`, `--fps`, `--quality high|standard`, and `--output`. `--zoom 1` or `--blur 0` disables that effect. Wallpaper, padding, browser and cursor form one scene; wallpaper may naturally remain visible during zoom. Do not fix that by removing padding or clamping the composition.

`record --capture-only` defers export. `--headed` shows Chromium. `--storage-state /absolute/session.auth.json` loads an existing authorized Playwright session into a new context. Existing browser sessions are not attached automatically. Use a fresh output directory per capture. Do not rerecord into a directory containing frames.

## Scope and delivery

Prefer a local/test instance and demo data. Capture replays actions: recording permission does not authorize sending messages, publishing, or other consequential production changes. Preserve the requested flow and existing authorization. Do not repeat a production submission just to rehearse it.

Deliver the MP4 inline when supported, with its absolute path. The CLI reports phases on stderr and the result as JSON on stdout. `workflow.json` separates preflight, browser setup, recording and export timing; browser setup is included in recording time. It does not measure the agent's earlier discovery/planning time. If the user reports slowness before capture, inspect that preparation rather than attributing it to rendering. `render.json` records export performance, and `timeline.json` records action timing and status. No extra benchmark is needed for ordinary delivery.

Only one Chromium tab is supported; no native windows, audio, webcam or popups. Source frames follow browser compositor cadence; 60 fps export does not guarantee 60 distinct source frames. Visible page content is captured, including typed text. Never claim Screen Studio parity or visual perfection from unit tests or a poster alone.
