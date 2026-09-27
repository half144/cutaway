<div align="center">

<img width="120" height="120" style="border-radius: 100px;" alt="Imagem do ChatGPT 27 de set  de 2026, 11_16_11" src="https://github.com/user-attachments/assets/de029b3d-8394-4b59-8a34-31199ef14565" />



# 🎬 Cutaway

**Polished web app demos, recorded by your agent.**

Animated zoom, a human cursor, motion blur and a macOS-style window, from a JSON plan to an MP4. Everything runs locally.

![Node.js 22+](https://img.shields.io/badge/node-%E2%89%A522-5FA04E?logo=nodedotjs&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?logo=playwright&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-libx264-007808?logo=ffmpeg&logoColor=white)
![Output](https://img.shields.io/badge/output-1080p%20%C2%B7%2060%20fps-8A2BE2)
![Agent skill](https://img.shields.io/badge/agent%20skill-Claude%20Code%20%C2%B7%20Codex-D97757)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

[Quick start](#-quick-start) · [Writing a plan](#-writing-a-plan) · [Phones](#-phones) · [Export](#-export) · [How it works](docs/how-it-works.md)

</div>

---

## ✨ See it

https://github.com/user-attachments/assets/3bd9af5a-d173-48a1-bcfd-838a1d5c9f93

25 s, 1080p, 60 fps, unedited, from [`examples/web-dashboard.json`](examples/web-dashboard.json) on the [shadcn/ui example dashboard](https://ui.shadcn.com/view/new-york-v4/dashboard-01). Zoom, cursor, pacing and background are the defaults.

<details>
<summary><b>📱 The same edits on an iPhone 15 Pro</b></summary>

https://github.com/user-attachments/assets/2c80b028-ebcc-45d9-8aaf-a642d342df32

30 s, 1080×1920, 60 fps, unedited, from [`examples/web-dashboard-mobile.json`](examples/web-dashboard-mobile.json): touch indicators, drags, the iOS keyboard and the phone frame are the defaults for a phone `device`.

</details>

## 🧭 What you get

- **A camera that follows the action.** Screen Studio-style zoom on typing, menus and small results; the overview for anything that fills the screen.
- **A cursor that moves like a person.** Arcs, Fitts' law timing, varied pauses and a click that presses in.
- **A finished scene.** Wallpaper, browser window with traffic lights, shadow, motion blur and a shortcut pill.
- **Honest timing.** Dead time is sped up; clicks, typing and results play at real speed.
- **Phones too.** Touch input, a drawn device, status bar and on-screen keyboard.

No AI model, cloud service or upload is involved: Playwright drives Chromium, Skia composes, FFmpeg encodes.

> [!NOTE]
> Screen Studio is the visual reference. Cutaway is not affiliated with it and does not match its editor.

## 🚀 Quick start

Requires **Node.js 22+** and **FFmpeg** (`brew install ffmpeg` on macOS).

```sh
curl -fsSL https://raw.githubusercontent.com/half144/cutaway/master/install.sh | bash
```

The installer downloads Cutaway into `~/.cutaway`, installs its dependencies and Chromium, and links the skill into Claude Code (`~/.claude/skills`) and Codex (`~/.codex/skills`) when they are installed. `CUTAWAY_HOME` changes the folder; a skill link that already points elsewhere is left alone.

**Updates are automatic.** Once a day, when the skill runs, the install fast-forwards to the latest `master` before anything loads, and reinstalls dependencies when they changed. Offline or with local edits it keeps the installed version. `CUTAWAY_NO_UPDATE=1` turns it off, and running the installer again updates on the spot. Clones made by hand never update themselves.

Then ask your agent for a recording (`/cutaway record the checkout flow` in Claude Code, `$cutaway` in Codex), or run the demo yourself:

```sh
node ~/.cutaway/src/cli.mjs record ~/.cutaway/examples/demo.json --out /tmp/cutaway-demo
```

The demo opens a local mock app, edits a project name and shows the result. Use a new `--out` folder for every recording.

<details>
<summary><b>Install from a clone</b></summary>

```sh
git clone https://github.com/half144/cutaway.git && cd cutaway
npm ci
npx playwright install chromium
npm run demo                                         # → recordings/demo/video.mp4
node scripts/install-skill.mjs                       # links the skill into Codex
ln -s "$PWD/skills/cutaway" ~/.claude/skills/cutaway # links the skill into Claude Code
```

The skill runs the CLI through its link, so keep the clone where it is.

</details>

<details>
<summary><b>Uninstall</b></summary>

```sh
rm -rf ~/.cutaway ~/.claude/skills/cutaway ~/.codex/skills/cutaway
```

</details>

## 📝 Writing a plan

A plan is a JSON file: a URL and the steps a person would take.

```json
{
  "url": "http://localhost:3000",
  "hide": ["nextjs-portal"],
  "steps": [
    { "action": "click", "selector": "#edit" },
    { "action": "type", "selector": "role=textbox[name=\"Title\"]", "text": "New title" },
    { "action": "upload", "selector": "button:has-text(\"Choose cover\")", "file": "cover.jpg" },
    { "action": "click", "selector": "#save", "expect": "#saved-message" },
    { "action": "focus", "selector": "#updated-title", "duration": 1.5 }
  ]
}
```

Selectors are [Playwright locators](https://playwright.dev/docs/other-locators): CSS, `role=…[name="…"]`, `:has-text()` and `:text-is()`. Each must match exactly one element.

### Actions

| Action | Parameters | What it does |
| --- | --- | --- |
| `click` | `selector` | Aims like a person, clicks and waits for the interface to settle |
| `type` | `selector`, `text` | Focuses the field, clears it and types at a human rhythm |
| `upload` | `selector`, `file` | Clicks the control that opens the file chooser and hands it `file` (a path or array, relative to the plan); no native dialog opens |
| `focus` | `selector`, `duration` | Frames an element without clicking; tall regions are read from the top |
| `scroll` | `y`, `duration` | Relative scroll in pixels: starts fast and glides to a stop |
| `press` | `key` | A key or shortcut on the focused element (`Enter`, `ControlOrMeta+K`) |
| `wait` | `duration` | Pause in seconds |

### Step options

| Option | What it does |
| --- | --- |
| `expect` | A selector that must become visible: the real success indicator, not an always-present container. The camera frames it with the control. |
| `pause` | Seconds to hold after the step. Leave it out: the recorder picks a human rhythm and holds results long enough to read. |
| `hold` | Seconds to keep a click or tap pressed (0.05–5), for a long press. |

### Plan options

| Option | Default | What it does |
| --- | --- | --- |
| `url` | required | `http:`, `https:` or `file:` (`file:./page.html` is relative to the plan) |
| `viewport` | `1440×810` | Browser size, 16:9 like the export |
| `device` | none | A phone from Playwright's device list; see [Phones](#-phones) |
| `captureScale` | `2` (`3` on phones) | Source pixel density; `3` for 4K exports |
| `hide` | none | CSS selectors removed from every frame, such as the Next.js dev badge |
| `timeout` | `10000` | Action time limit in milliseconds (up to 120000) |

Ambiguous selectors, missing elements and unmet expectations stop the recording, and export refuses incomplete sessions. For an app behind a login, pass `--storage-state /path/session.auth.json` with a saved Playwright state; `--headed` shows the browser.

> [!WARNING]
> The recorder really performs each step. A local frontend can still point at a production API or database, so check where it writes before recording a step that saves, pays or sends something.

## 📱 Phones

Add `device` and write `tap` and `swipe` in place of `click` and `scroll`. The same plan records on desktop and phone.

```json
{
  "url": "http://localhost:3000",
  "device": "iPhone 15 Pro",
  "steps": [
    { "action": "tap", "selector": "#add", "expect": "#new-task" },
    { "action": "type", "selector": "#task-title", "text": "Review the mobile prototype" },
    { "action": "swipe", "y": 420 },
    { "action": "tap", "selector": "#task", "hold": 0.7 }
  ]
}
```

- **Devices:** any portrait phone from Playwright's list (`iPhone 15 Pro`, `iPhone 17 Pro`, `Pixel 7`, `Galaxy S24`…), emulated in Chromium with its user agent, touch input and layout, captured at 3×.
- **Video:** 1080×1920 with a drawn phone, status bar, touch indicators and an iOS-style keyboard while typing.
- **Other formats:** `--width 1080 --height 1350` for a feed post, `--width 1920 --height 1080` for landscape, `--window none` for the page alone.
- **Not covered:** Safari's rendering quirks (it's Chromium, not WebKit) and tablets.

Local example with no network: [`examples/mobile-demo.json`](examples/mobile-demo.json).

## 🎞️ Export

`record` captures and exports in one go. `render` re-exports a saved capture without repeating the actions.

```sh
node src/cli.mjs record plan.json --out recordings/take --capture-only   # capture only
node src/cli.mjs render recordings/take --width 1280 --height 720        # quick preview
node src/cli.mjs render recordings/take --preset midnight --zoom 2       # another look
```

| Option | Default | Range |
| --- | --- | --- |
| `--width`, `--height` | 1920×1080 (1080×1920 on phones) | 320–3840, even |
| `--fps` | 60 | 24–60 |
| `--quality` | `high` (CRF 16) | `high`, `standard` (about 3× faster) |
| `--zoom` | 1.5 | 1–3; 1 turns zoom off |
| `--blur` | 0.75 | 0–1; 0 turns motion blur off |
| `--cursor-size` | 2 | 0.5–4 |
| `--padding` | 0.09 | 0–0.25 |
| `--preset` | `sonoma-horizon` (`macos` without imported wallpapers) | `macos`, `dusk`, `midnight`, `pearl` or an imported wallpaper |
| `--window` | `browser` (`device` on phones) | `browser`, `device`, `none` |
| `--keys` | `combos` | `combos`, `all`, `none` |
| `--pacing` | `balanced` | `balanced` (speeds up dead time), `original` |
| `--output` | `<recording>/video.mp4` | any path |

> [!TIP]
> For PR evidence and bug repros, `--width 1280 --height 720 --quality standard` exports about 3× faster and keeps ~30 s under GitHub's 10 MB attachment limit.

**More wallpapers:** `npm run wallpapers` converts the macOS wallpapers on this Mac to presets (`--preset tahoe-day`); add `--download` to `node scripts/import-wallpapers.mjs` for the ones macOS fetches on demand. They stay out of git, since they belong to Apple.

### Session files

| File | Contents |
| --- | --- |
| `video.mp4` | The finished video |
| `poster.png` | A frame from the middle, for a quick look |
| `frames/*.png` | Lossless source frames |
| `timeline.json` | Timestamps, cursor, clicks, focus regions and status |
| `render.json` | Export settings, timing and a `motion` summary (shots, zoom share, shortest close-up) |
| `camera.json` | The camera path, for diagnostics |
| `workflow.json` | Preflight, browser setup, recording and export timing |

The frames show whatever the page shows, including typed text. On phones, the timeline also keeps the typed characters to draw the keyboard, except in password fields.

## 🚧 Limits

- One Chromium tab, driven by the CLI. No popups, native windows, drag-and-drop, audio or webcam.
- Page animations are captured at the browser's pace: 60 fps output doesn't mean 60 distinct app frames. Scrolls (and phone animations) are captured in slow motion to compensate.
- Changing the aspect ratio adds margin; desktop recordings aren't reframed for vertical video. Use a phone `device` instead.
- Composition and encoding run on the CPU. GPU composition and hardware encoding aren't implemented.
- Custom canvas or iframe cursors aren't captured; the arrow, hand and I-beam are.

## 🧪 Development

```sh
npm test          # camera, cursor, pacing, plan validation, CLI
npm run check     # syntax-checks every script
npm run demo      # records and exports the local example end to end
```

Tests don't judge how the video looks: watch the MP4. [`examples/extended-demo.json`](examples/extended-demo.json) runs 38 actions (forms, menus, scrolling, wide regions, simulated loads) against a local page for a longer check.

## 📚 Learn more

- [How it works](docs/how-it-works.md): pacing, camera, cursor, composition, phones, architecture and performance.
- [Quality review](docs/quality-review.md) and [motion review](docs/motion-review.md): measurements and references.
- [Technical history](docs/history.md).

## 📄 License

[MIT](LICENSE). The macOS wallpapers imported by `npm run wallpapers` belong to Apple and are not covered by it.
