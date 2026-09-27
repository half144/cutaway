import { setTimeout as sleep } from 'node:timers/promises';
import { clamp, ease, unitNoise } from '../motion.mjs';
import { ActionRunner, scrollSlowdown } from './actions.mjs';
import { gaussian, movementDuration, pointingDifficulty } from './pacing.mjs';
import { isDragSpot, scrollIntoComfort, targetNeedsScroll } from './page-state.mjs';

// Chromium starts scrolling only once a finger has moved this far (CSS pixels), so a drag is that much
// longer than the scroll it makes. Measured: a 400 px drag scrolls 385 px.
const touchSlop = 15;
// A drag covers at most this share of the scroll area; longer scrolls take several strokes.
const dragShare = 0.75;
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
    this.animationSlowdown = scrollSlowdown;
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

  // Animations and transitions a tap or key sets off (a sheet sliding up, a menu fading in) run 4× slower
  // while captured, like scrolls, and the render plays them back at real speed: at 3× the screencast
  // delivers ~20 fps, 9 frames for a 0.4 s slide. JS timers keep real time.
  async slowAnimations() {
    if (this.slowSince !== undefined) return;
    await this.session.send('Animation.setPlaybackRate', { playbackRate: 1 / this.animationSlowdown });
    this.slowSince = this.now();
  }

  async settled() {
    if (this.slowSince === undefined) return;
    await this.session.send('Animation.setPlaybackRate', { playbackRate: 1 });
    (this.timeline.slowMotion ??= []).push({ start: this.slowSince, end: this.now(), factor: this.animationSlowdown });
    this.slowSince = undefined;
  }

  async press(seconds) {
    const t = this.now();
    await this.touch('touchStart', this.pointer);
    await sleep(seconds * 1000);
    await this.slowAnimations();
    await this.touch('touchEnd');
    this.timeline.touches.push({ t, up: this.now(), points: [{ t, ...this.pointer }] });
  }

  // The on-screen keyboard shows which keys are pressed; a password's are not kept.
  async pressKey(key) {
    await this.slowAnimations();
    return super.pressKey(key);
  }

  // Typing plays at real speed: only the tap that focused the field was slowed.
  async type(locator, text, focus, index) {
    await this.settled();
    const field = await locator.evaluate(element => ({
      secret: element.type === 'password',
      numeric: /^(number|tel)$/.test(element.type) || /^(numeric|decimal|tel)$/.test(element.inputMode),
    }));
    this.secret = field.secret;
    // Text without letters is typed on the 123 plane, as someone would switch to it first.
    focus.keyboard = field.numeric ? 'numeric' : /\p{L}/u.test(text) ? 'text' : 'numbers';
    focus.keys = [];
    await super.type(locator, text, focus, index);
  }

  typeCharacter(character, focus) {
    focus.keys.push({ t: this.now(), key: this.secret ? null : character });
    return super.typeCharacter(character);
  }

  // One stroke that scrolls `delta` along `axis` inside `area` (positive scrolls down or right, so the
  // finger moves up or left), captured in slow motion like wheel scrolls. The finger comes to rest before
  // lifting, so the page stops with it instead of flinging on.
  async drag(delta, area, seed, seconds, axis = 'y') {
    const length = Math.abs(delta) + touchSlop;
    const direction = Math.sign(delta);
    const vertical = axis === 'y';
    let middle = vertical ? area.y + area.height / 2 : area.x + area.width / 2;
    let lane = vertical ? area.x + area.width * (0.5 + 0.16 * unitNoise(seed * 97 + 3)) : area.y + area.height / 2;
    const at = (travel, sideways) => {
      const along = middle + direction * length / 2 - direction * length * travel;
      return vertical ? { x: lane + sideways, y: along } : { x: along, y: lane + sideways };
    };
    // The finger lands where it sets nothing off, such as a chart tooltip or a button, when the stroke
    // can move sideways or along the area to find such a spot. Near the screen's edges, where a thumb
    // often swipes, a page usually has bare margin.
    const slack = Math.max(0, ((vertical ? area.height : area.width) - length) / 2 - 8);
    const lanes = vertical
      ? [lane, ...[0.3, 0.7, 0.15, 0.85].map(share => area.x + area.width * share), area.x + area.width - 16, area.x + 16]
      : [lane];
    const starts = [0, slack / 2, -slack / 2, slack, -slack].flatMap(shift => lanes.map(candidate => [candidate, middle + shift]));
    let quiet = false;
    for (const start of starts) {
      [lane, middle] = start;
      quiet = await this.page.evaluate(isDragSpot, at(0, 0));
      if (quiet) break;
    }
    if (!quiet) [lane, middle] = starts[0];
    const from = at(0, 0);
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
      point = at(travel, bow * Math.sin(Math.PI * travel));
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

  async swipe(distance, area, seconds, axis = 'y') {
    // A sliver of a scroll area still gets strokes a finger could make.
    const reach = (axis === 'y' ? area.height : area.width) * dragShare - touchSlop;
    const count = Math.ceil(Math.abs(distance) / Math.max(80, reach));
    for (let i = 0; i < count; i++) {
      // Lifting and placing the thumb again for the next stroke.
      if (i) await sleep((0.14 + 0.1 * unitNoise(this.movementIndex * 131 + i)) * 1000);
      await this.drag(distance / count, area, this.movementIndex++, seconds && seconds / count, axis);
    }
  }

  // A person scrolls a target into view with their finger: down the page, then along a table wider
  // than the screen, and once more if the page stopped short. The page does not glide on its own.
  async bringIntoView(element, next) {
    const measure = () => this.page.evaluate(scrollIntoComfort, [element, next, 1, true]);
    const { distance, area } = await measure();
    if (Math.abs(distance) >= 1) await this.swipe(distance, area);
    const { across } = await measure();
    if (across && Math.abs(across.distance) >= 1) await this.swipe(across.distance, across.area, undefined, 'x');
    if (await element.evaluate(targetNeedsScroll)) {
      const retry = await measure();
      if (Math.abs(retry.distance) >= 1) await this.swipe(retry.distance, retry.area);
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
