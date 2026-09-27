import { setTimeout as sleep } from 'node:timers/promises';
import { clamp, ease, unitNoise } from '../motion.mjs';
import { ActionRunner, scrollSlowdown } from './actions.mjs';
import { gaussian, movementDuration, pointingDifficulty } from './pacing.mjs';
import { scrollIntoComfort, targetNeedsScroll } from './page-state.mjs';

// Chromium starts scrolling only once a finger has moved this far (CSS pixels), so a drag is that much
// longer than the scroll it makes. Measured: a 400 px drag scrolls 385 px.
const touchSlop = 15;
// A drag covers at most this share of the scroll area; longer scrolls take several strokes.
const dragShare = 0.6;
// Contact radius of a fingertip, in CSS pixels.
const fingertip = 11;
// Quick departure and a long glide to rest. A slow start would hold the finger still long enough
// to count as a long press.
const dragCurve = t => ease(clamp(t, 0, 1) ** 0.6);

// Gestures of a phone held in one hand: taps and drags through CDP touch events, which Chromium
// handles like a real touchscreen (touch and pointer events, click, scrolling). Playwright's own
// touchscreen API only taps, without a hold or a drag.
export class TouchRunner extends ActionRunner {
  constructor(page, timeline, now, session) {
    const { width, height } = page.viewportSize();
    // The thumb waits over the lower middle of the screen.
    super(page, timeline, now, { x: width / 2, y: height * 0.7 });
    this.session = session;
    timeline.touches ??= [];
  }

  // A phone has no pointer to show.
  async captureCursor() {}

  touch(type, point) {
    return this.session.send('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [{ x: point.x, y: point.y, radiusX: fingertip, radiusY: fingertip }] : [],
    });
  }

  // The thumb travels unseen above the glass, and its travel time is the beat before the tap. The
  // journey is kept as pointer samples so the camera sets off with it; they are never drawn.
  async moveTo(target, targetWidth = 40) {
    const distance = Math.hypot(target.x - this.pointer.x, target.y - this.pointer.y);
    if (distance <= 2) return;
    const seed = this.movementIndex++;
    this.difficulty = pointingDifficulty(distance, targetWidth);
    const start = this.now();
    await sleep(movementDuration(distance, targetWidth, gaussian(seed * 389 + 17)) * 1000);
    this.timeline.points.push({ t: start, ...this.pointer }, { t: this.now(), ...target });
    this.pointer = target;
  }

  // Between gestures the thumb stays put; it sets off as the next step begins.
  async rest(seconds) {
    await sleep(seconds * 1000);
  }

  async press(seconds) {
    const t = this.now();
    await this.touch('touchStart', this.pointer);
    await sleep(seconds * 1000);
    await this.touch('touchEnd');
    this.timeline.touches.push({ t, up: this.now(), points: [{ t, ...this.pointer }] });
  }

  // The on-screen keyboard shows which keys are pressed; a password's are not kept.
  async type(locator, text, focus, index) {
    const field = await locator.evaluate(element => ({
      secret: element.type === 'password',
      numeric: /^(number|tel)$/.test(element.type) || /^(numeric|decimal|tel)$/.test(element.inputMode),
    }));
    this.secret = field.secret;
    focus.keyboard = field.numeric ? 'numeric' : 'text';
    focus.keys = [];
    await super.type(locator, text, focus, index);
  }

  typeCharacter(character, focus) {
    focus.keys.push({ t: this.now(), key: this.secret ? null : character });
    return super.typeCharacter(character);
  }

  // One stroke that scrolls `dy` (positive scrolls down, so the finger moves up) inside `area`, captured
  // in slow motion like wheel scrolls. The finger comes to rest before lifting, so the page stops with
  // it instead of flinging on.
  async drag(dy, area, seed, seconds) {
    const length = Math.abs(dy) + touchSlop;
    const direction = Math.sign(dy);
    const from = {
      x: area.x + area.width * (0.5 + 0.16 * unitNoise(seed * 97 + 3)),
      y: area.y + area.height / 2 + direction * length / 2,
    };
    // A thumb pivots at its base, so the stroke bows a little sideways.
    const bow = length * (0.03 + 0.03 * unitNoise(seed * 97 + 5));
    const duration = (seconds ?? clamp(0.28 + length / 1400, 0.35, 0.8)) * scrollSlowdown;
    const start = this.now();
    const points = [{ t: start, ...from }];
    let point = from;
    await this.touch('touchStart', from);
    await sleep(30 * scrollSlowdown);
    const beginning = performance.now();
    for (let progress = 0; progress < 1;) {
      await sleep(1000 / 60);
      progress = Math.min(1, (performance.now() - beginning) / (duration * 1000));
      const travel = dragCurve(progress);
      point = { x: from.x + bow * Math.sin(Math.PI * travel), y: from.y - direction * length * travel };
      await this.touch('touchMove', point);
      points.push({ t: this.now(), ...point });
    }
    await sleep(60 * scrollSlowdown);
    await this.touch('touchEnd');
    const up = this.now();
    this.timeline.touches.push({ t: start, up, points });
    (this.timeline.slowMotion ??= []).push({ start, end: up, factor: scrollSlowdown });
    this.pointer = point;
  }

  async swipe(distance, area, seconds) {
    // A sliver of a scroll area still gets strokes a finger could make.
    const count = Math.ceil(Math.abs(distance) / Math.max(80, area.height * dragShare - touchSlop));
    for (let i = 0; i < count; i++) {
      // Lifting and placing the thumb again for the next stroke.
      if (i) await sleep((0.14 + 0.1 * unitNoise(this.movementIndex * 131 + i)) * 1000);
      await this.drag(distance / count, area, this.movementIndex++, seconds && seconds / count);
    }
  }

  // A person scrolls a target into view with their finger, and drags once more if it fell short;
  // the page does not glide on its own.
  async bringIntoView(element, next) {
    for (let stroke = 0; stroke < 2 && (stroke === 0 || await element.evaluate(targetNeedsScroll)); stroke++) {
      const { distance, area } = await this.page.evaluate(scrollIntoComfort, [element, next, 1, true]);
      if (Math.abs(distance) >= 1) await this.swipe(distance, area);
    }
  }

  async scroll(step) {
    const scroll = { start: this.now(), automatic: false };
    (this.timeline.scrolls ??= []).push(scroll);
    const { width, height } = this.page.viewportSize();
    await this.swipe(step.y, { x: 0, y: 0, width, height }, step.duration);
    await sleep(100);
    scroll.end = this.now();
  }
}
