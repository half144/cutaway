import { createCanvas } from '@napi-rs/canvas';
import { drawKeyboard } from './keyboard.mjs';
import { uiFont } from './toolbar.mjs';

// Stylized phones in CSS pixels (points), drawn as vectors. The iPhone follows the 14 Pro to 17 Pro:
// 55 pt display corners, a 126 × 37 pt Dynamic Island 11 pt below the top edge, and ~16.5 pt from the
// edge of the glass to the edge of the body (70.6 mm body, 65.1 mm display on the 15 Pro).
// Side buttons are [side, top, length], as shares of the body height.
const models = {
  iphone: {
    bezel: 16.5, band: 4, screenRadius: 55,
    island: { width: 126, height: 37, top: 11 },
    home: { width: 134, height: 5, bottom: 8 },
    buttons: [['left', 0.165, 0.042], ['left', 0.245, 0.072], ['left', 0.335, 0.072], ['right', 0.27, 0.112]],
  },
  android: {
    bezel: 11, band: 3, screenRadius: 34,
    camera: { radius: 11, top: 18 },
    home: { width: 108, height: 4, bottom: 9 },
    buttons: [['right', 0.2, 0.075], ['right', 0.31, 0.13]],
  },
};

// Page-pixel geometry, with the page's top-left corner at the origin: the screen extends above and
// below the page by the system bars, and the body around the screen by the bezel.
export function deviceLayout(device, viewport) {
  const model = models[device.kind];
  const { top, bottom } = device.insets;
  const screen = { x: 0, y: -top, width: viewport.width, height: top + viewport.height + bottom };
  const body = {
    x: -model.bezel, y: screen.y - model.bezel,
    width: screen.width + model.bezel * 2, height: screen.height + model.bezel * 2,
  };
  return { kind: device.kind, model, screen, body };
}

// Places the phone in the output like createFrame places a window: centered, inside the padding.
export function createDeviceFrame(width, height, viewport, padding, layout) {
  const { body, screen, model } = layout;
  const ratio = Math.min(width * (1 - padding * 2) / body.width, height * (1 - padding * 2) / body.height);
  const window = {
    width: body.width * ratio,
    height: body.height * ratio,
    radius: (model.screenRadius + model.bezel) * ratio,
  };
  window.x = (width - window.width) / 2;
  window.y = (height - window.height) / 2;
  const origin = { x: window.x - body.x * ratio, y: window.y - body.y * ratio };
  const frame = {
    x: origin.x,
    y: origin.y,
    width: viewport.width * ratio,
    height: viewport.height * ratio,
    radius: 0,
    toolbar: 0,
    screen: {
      x: origin.x + screen.x * ratio,
      y: origin.y + screen.y * ratio,
      width: screen.width * ratio,
      height: screen.height * ratio,
      radius: model.screenRadius * ratio,
    },
  };
  return { frame, window, ratio, scene: { width: width / ratio, height: height / ratio }, bounds: body };
}

export function drawDeviceBody(context, window, layout) {
  const { model, body } = layout;
  const unit = window.width / body.width;
  context.save();
  context.fillStyle = '#2c2d31';
  for (const [side, top, length] of model.buttons) {
    const x = side === 'left' ? window.x - 2.6 * unit : window.x + window.width - 0.4 * unit;
    context.beginPath();
    context.roundRect(x, window.y + top * window.height, 3 * unit, length * window.height, 1.5 * unit);
    context.fill();
  }
  // A dark titanium band catching light at two corners.
  const band = context.createLinearGradient(window.x, window.y, window.x + window.width, window.y + window.height);
  band.addColorStop(0, '#6e7076');
  band.addColorStop(0.3, '#3a3b40');
  band.addColorStop(0.7, '#2a2b2f');
  band.addColorStop(1, '#5c5e64');
  context.fillStyle = band;
  context.beginPath();
  context.roundRect(window.x, window.y, window.width, window.height, window.radius);
  context.fill();
  context.strokeStyle = '#ffffff30';
  context.lineWidth = 0.7 * unit;
  context.beginPath();
  context.roundRect(window.x + 0.35 * unit, window.y + 0.35 * unit, window.width - 0.7 * unit, window.height - 0.7 * unit,
    window.radius - 0.35 * unit);
  context.stroke();
  const inset = model.band * unit;
  context.fillStyle = '#050506';
  context.beginPath();
  context.roundRect(window.x + inset, window.y + inset, window.width - inset * 2, window.height - inset * 2, window.radius - inset);
  context.fill();
  context.restore();
}

// The color of the page's first and last pixel rows, per captured frame: the system bars take it, and
// its lightness picks the ink drawn over them. The median ignores a sliver of something else on the
// edge (a toast parked just off screen), which would otherwise tint the whole bar.
const edgeCache = new WeakMap();
const probe = createCanvas(64, 1);
const probeContext = probe.getContext('2d');

function edgeColor(source, row) {
  probeContext.drawImage(source, 0, row, source.width, 1, 0, 0, 64, 1);
  const pixels = probeContext.getImageData(0, 0, 64, 1).data;
  const [r, g, b] = [0, 1, 2].map(channel => pixels.filter((_, i) => i % 4 === channel).sort((x, y) => x - y)[32]);
  return { color: `rgb(${r},${g},${b})`, dark: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5 };
}

function edges(source) {
  if (!edgeCache.has(source)) edgeCache.set(source, { top: edgeColor(source, 0), bottom: edgeColor(source, source.height - 1) });
  return edgeCache.get(source);
}

function drawSignal(context, x, y, unit) {
  [4, 6.2, 8.4, 10.6].forEach((height, index) => {
    context.beginPath();
    context.roundRect(x + index * 4.6 * unit, y + (5.3 - height) * unit, 3.2 * unit, height * unit, 1 * unit);
    context.fill();
  });
}

function drawWifi(context, x, y, unit) {
  const center = { x: x + 7.7 * unit, y: y + 5.3 * unit };
  context.beginPath();
  context.moveTo(center.x, center.y);
  context.arc(center.x, center.y, 3.6 * unit, -Math.PI * 0.75, -Math.PI * 0.25);
  context.closePath();
  context.fill();
  context.lineWidth = 2.1 * unit;
  for (const radius of [7, 10.6]) {
    context.beginPath();
    context.arc(center.x, center.y, radius * unit, -Math.PI * 0.75, -Math.PI * 0.25);
    context.stroke();
  }
}

function drawBattery(context, x, y, unit, ink) {
  context.save();
  context.globalAlpha *= 0.4;
  context.lineWidth = 1 * unit;
  context.beginPath();
  context.roundRect(x + 0.5 * unit, y - 5.5 * unit, 24 * unit, 11.5 * unit, 3.6 * unit);
  context.stroke();
  context.beginPath();
  context.roundRect(x + 25.6 * unit, y - 2 * unit, 1.6 * unit, 4.3 * unit, 0.8 * unit);
  context.fill();
  context.restore();
  context.fillStyle = ink;
  context.beginPath();
  context.roundRect(x + 2.5 * unit, y - 3.5 * unit, 20 * unit, 7.5 * unit, 2 * unit);
  context.fill();
}

function drawStatusBar(context, screen, layout, unit, ink) {
  const { kind, model } = layout;
  context.save();
  context.fillStyle = ink;
  context.strokeStyle = ink;
  context.textBaseline = 'middle';
  if (kind === 'iphone') {
    const middle = screen.y + (model.island.top + model.island.height / 2) * unit;
    const ear = (screen.width - model.island.width * unit) / 2;
    context.font = `600 ${17 * unit}px ${uiFont}`;
    context.textAlign = 'center';
    context.fillText('9:41', screen.x + ear / 2 + 4 * unit, middle);
    // Signal, Wi-Fi and battery, centered in the right ear.
    const groupWidth = 76 * unit;
    let x = screen.x + screen.width - ear / 2 - groupWidth / 2 - 4 * unit;
    drawSignal(context, x, middle, unit);
    x += 20 * unit;
    drawWifi(context, x, middle - 1 * unit, unit);
    x += 22 * unit;
    drawBattery(context, x, middle, unit, ink);
  } else {
    const middle = screen.y + model.camera.top * unit;
    context.font = `500 ${14.5 * unit}px ${uiFont}`;
    context.textAlign = 'left';
    context.fillText('9:41', screen.x + 24 * unit, middle);
    let x = screen.x + screen.width - 76 * unit;
    drawWifi(context, x, middle - 1 * unit, unit);
    x += 20 * unit;
    drawSignal(context, x, middle, unit);
    x += 22 * unit;
    drawBattery(context, x, middle, unit, ink);
  }
  context.restore();
}

function drawCameraCutout(context, screen, layout, unit) {
  const { kind, model } = layout;
  const center = screen.x + screen.width / 2;
  context.save();
  context.fillStyle = '#000000';
  let lens;
  if (kind === 'iphone') {
    const { width, height, top } = model.island;
    context.beginPath();
    context.roundRect(center - width / 2 * unit, screen.y + top * unit, width * unit, height * unit, height / 2 * unit);
    context.fill();
    lens = { x: center + (width / 2 - height / 2) * unit, y: screen.y + (top + height / 2) * unit, radius: 6 * unit };
  } else {
    const { radius, top } = model.camera;
    context.beginPath();
    context.arc(center, screen.y + top * unit, radius * unit, 0, Math.PI * 2);
    context.fill();
    lens = { x: center, y: screen.y + top * unit, radius: radius * 0.55 * unit };
  }
  const glass = context.createRadialGradient(lens.x - lens.radius * 0.3, lens.y - lens.radius * 0.3, 0, lens.x, lens.y, lens.radius);
  glass.addColorStop(0, '#2a3350');
  glass.addColorStop(1, '#07080d');
  context.fillStyle = glass;
  context.beginPath();
  context.arc(lens.x, lens.y, lens.radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

// The screen: the page between the system bars, which take the color of the page's edges as a
// browser tints them, the keyboard while typing (lifting the page when it would cover the field), then
// the status bar, the camera cutout and the home indicator on top.
export function drawScreen(context, { source, frame, device, keyboard }) {
  const { screen } = frame;
  const unit = frame.width / device.screen.width;
  const y = frame.y - (keyboard?.lift ?? 0) * unit;
  const bottom = y + frame.height;
  context.save();
  context.beginPath();
  context.roundRect(screen.x, screen.y, screen.width, screen.height, screen.radius);
  context.clip();
  const edge = edges(source);
  context.fillStyle = edge.top.color;
  context.fillRect(frame.x, screen.y, frame.width, y - screen.y + 1);
  context.fillStyle = edge.bottom.color;
  context.fillRect(frame.x, bottom - 1, frame.width, screen.y + screen.height - bottom + 1);
  context.drawImage(source, frame.x, y, frame.width, frame.height);
  // The keyboard follows the app's appearance, as a phone in dark mode would show it.
  if (keyboard) drawKeyboard(context, screen, unit, keyboard, edge.bottom.dark);
  context.restore();

  const bottomDark = edge.bottom.dark;
  drawStatusBar(context, screen, device, unit, edge.top.dark ? '#ffffff' : '#000000');
  drawCameraCutout(context, screen, device, unit);
  const { width, height, bottom: gap } = device.model.home;
  context.save();
  context.fillStyle = bottomDark ? '#ffffffe0' : '#000000d9';
  context.beginPath();
  context.roundRect(screen.x + (screen.width - width * unit) / 2, screen.y + screen.height - (gap + height) * unit,
    width * unit, height * unit, height / 2 * unit);
  context.fill();
  context.restore();
}
