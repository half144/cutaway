import { parseArgs } from 'node:util';

export const help = `agent-screen — cinematic browser recordings for agents

  agent-screen doctor
  agent-screen validate <plan.json>
  agent-screen record <plan.json> --out <new-directory> [--headed] [--capture-only]
  agent-screen render <recording-directory> [--output <video.mp4>]

Rendering: --width 1920 --height 1080 --fps 60 --zoom 1.8 --blur 0.75
           --cursor-size 2 --padding 0.09 --preset macos|dusk|midnight|pearl|<wallpaper>
           (npm run wallpapers imports this Mac's wallpapers as presets)
           --window browser|device|none --keys combos|all|none
           (phone recordings default to 1080x1920 and --window device)
           --pacing balanced|original --quality high|standard
Capture:   --storage-state <auth.json> (existing Playwright storage state)

Plans and local demo: examples/demo.json. Full usage: README.md.
All recordings stay local. Re-rendering does not repeat browser actions.`;

const numericRenderFlags = {
  width: 'width',
  height: 'height',
  fps: 'fps',
  zoom: 'maxZoom',
  blur: 'blur',
  'cursor-size': 'cursorSize',
  padding: 'padding',
};

export function parseCliArgs(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      output: { type: 'string' },
      headed: { type: 'boolean' },
      'capture-only': { type: 'boolean' },
      'storage-state': { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      fps: { type: 'string' },
      zoom: { type: 'string' },
      blur: { type: 'string' },
      'cursor-size': { type: 'string' },
      padding: { type: 'string' },
      preset: { type: 'string' },
      pacing: { type: 'string' },
      quality: { type: 'string' },
      window: { type: 'string' },
      keys: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const [command, input] = positionals;
  if (values.help || !command) return { showHelp: true };
  if (command === 'doctor' && positionals.length === 1) return { command, values };
  if (!['record', 'render', 'validate'].includes(command) || !input || positionals.length !== 2) {
    throw new Error(help);
  }

  const renderOptions = {};
  for (const [flag, key] of Object.entries(numericRenderFlags)) {
    if (values[flag] !== undefined) renderOptions[key] = Number(values[flag]);
  }
  if (values.preset) renderOptions.preset = values.preset;
  if (values.pacing) renderOptions.pacing = values.pacing;
  if (values.quality) renderOptions.quality = values.quality;
  if (values.window) renderOptions.window = values.window;
  if (values.keys) renderOptions.keys = values.keys;
  if (values.output) renderOptions.output = values.output;

  return { command, input, values, renderOptions, showHelp: false };
}
