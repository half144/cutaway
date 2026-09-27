import { setTimeout as sleep } from 'node:timers/promises';
import { ease, pointerPath, targetPoint, unitNoise } from '../motion.mjs';
import {
  clickHold, clickSettleDelay, gaussian, homingDelay, movementDuration, pauseAfter, pointingDifficulty, typingDelays,
} from './pacing.mjs';
import {
  caretPoint, cursorAtPoint, resultInfo, scrollIntoComfort, targetContext, targetNeedsScroll,
  waitForSettled, waitForStableTarget, watchChanges,
} from './page-state.mjs';

// Buttons that commit something; a person hesitates a beat before pressing them.
// Scrolls are captured this many times slower than they play back. The screencast delivers frames at
// the compositor's pace, 11–50 fps at 2× while new content paints, so a real-time scroll steps visibly;
// in slow motion every output frame gets its own capture. The render restores real speed.
const scrollSlowdown = 4;
const commitLabel = /\b(save|salvar|done|concluir|submit|enviar|send|delete|excluir|remove|remover|confirm|confirmar|publish|publicar|apply|aplicar|create|criar|pay|pagar)\b/i;

function containsPoint(box, point) {
  return point && point.x >= box.x && point.x <= box.x + box.width
    && point.y >= box.y && point.y <= box.y + box.height;
}

export class ActionRunner {
  constructor(page, timeline, now, pointer) {
    this.page = page;
    this.timeline = timeline;
    this.now = now;
    this.pointer = pointer;
    this.cursorSampleAt = -Infinity;
    this.movementIndex = 0;
    this.difficulty = 0;
    this.approach = null;
  }

  async captureCursor(force = false) {
    const t = this.now();
    if (!force && t - this.cursorSampleAt < 0.1) return;
    this.cursorSampleAt = t;
    const type = await this.page.evaluate(cursorAtPoint, this.pointer);
    const cursors = this.timeline.cursors ??= [];
    if (cursors.at(-1)?.type !== type) cursors.push({ t, type });
  }

  // Dispatches a timed path and records it with its planned timing: a page too busy to take every move
  // on time must not stretch the stroke on screen; the pointer then simply waits on target a moment.
  async follow(path) {
    const beginning = performance.now();
    const start = this.now();
    this.timeline.points.push({ t: start, ...this.pointer });
    for (let i = 1; i < path.length; i++) {
      // Skip overdue samples instead of replaying a burst when the browser is busy.
      while (i + 1 < path.length && path[i + 1].t * 1000 < performance.now() - beginning) i++;
      const point = path[i];
      await sleep(Math.max(0, point.t * 1000 - (performance.now() - beginning)));
      await this.page.mouse.move(point.x, point.y);
      this.pointer = { x: point.x, y: point.y };
      await this.captureCursor();
    }
    for (const point of path.slice(1)) this.timeline.points.push({ t: start + point.t, x: point.x, y: point.y });
    await this.captureCursor(true);
  }

  async moveTo(target, targetWidth = 40) {
    const distance = Math.hypot(target.x - this.pointer.x, target.y - this.pointer.y);
    if (distance <= 2) return;
    const seed = this.movementIndex++;
    this.difficulty = pointingDifficulty(distance, targetWidth);
    const duration = movementDuration(distance, targetWidth, gaussian(seed * 389 + 17));
    await this.follow(pointerPath(this.pointer, target, duration, { seed, targetWidth }));
    this.pointer = target;
  }

  // Where the next step will land, if its target is already on screen without scrolling.
  async upcomingTarget(step, index) {
    if (!step?.selector || step.action === 'focus') return null;
    try {
      const locator = this.page.locator(step.selector);
      if (await locator.count() !== 1) return null;
      const box = await locator.boundingBox();
      const viewport = this.page.viewportSize();
      if (!box || box.y < 8 || box.x < 0 || box.y + box.height > viewport.height - 8 || box.x + box.width > viewport.width) return null;
      return { point: targetPoint(box, index), width: Math.min(box.width, box.height) };
    } catch {
      return null;
    }
  }

  // A rest between actions. The hand is still while the viewer takes in the result; when the next target
  // is already on screen and there is time, it then moves there in one calm stroke and waits on it, as
  // someone who knows where they click next. Never a slow creep followed by a second stroke.
  async rest(seconds, nextStep, index, afterTyping) {
    const beginning = performance.now();
    const remaining = () => Math.max(0, seconds * 1000 - (performance.now() - beginning));
    const next = seconds >= 0.45 && !afterTyping ? await this.upcomingTarget(nextStep, index + 1) : null;
    if (next && Math.hypot(next.point.x - this.pointer.x, next.point.y - this.pointer.y) > 2) {
      await sleep(remaining() * (0.35 + 0.25 * unitNoise(index * 353 + 5)));
      if (remaining() >= 250) {
        this.approach = { selector: nextStep.selector, start: this.now() };
        await this.moveTo(next.point, next.width);
      }
    }
    await sleep(remaining());
  }

  async uniqueHandle(selector) {
    if (!selector) return null;
    const handles = await this.page.$$(selector);
    if (handles.length === 1) return handles[0];
    await Promise.all(handles.map(handle => handle.dispose()));
    return null;
  }

  async resolveTarget(step, index, nextStep) {
    if (!step.selector) return {};

    const locator = this.page.locator(step.selector);
    await locator.waitFor({ state: 'visible' });
    if (await locator.count() !== 1) {
      throw new Error(`Step ${index + 1}: selector must match exactly one element.`);
    }

    const needsScroll = await locator.evaluate(targetNeedsScroll);
    if (needsScroll) {
      const scroll = { start: this.now(), automatic: true };
      (this.timeline.scrolls ??= []).push(scroll);
      // Bring the next target along when it fits, so consecutive steps don't each need a scroll.
      const next = await this.uniqueHandle(nextStep?.selector);
      const element = await locator.elementHandle();
      const slowMotion = { start: this.now(), factor: scrollSlowdown };
      await this.page.evaluate(scrollIntoComfort, [element, next, scrollSlowdown]);
      slowMotion.end = this.now();
      (this.timeline.slowMotion ??= []).push(slowMotion);
      await Promise.all([element, next].filter(Boolean).map(handle => handle.dispose()));
      if (await locator.evaluate(targetNeedsScroll)) {
        await locator.evaluate(target => target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }));
      }
      await locator.evaluate(waitForStableTarget);
      scroll.end = this.now();
    }

    if (step.action !== 'focus') await locator.click({ trial: true });
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Step ${index + 1}: target has no bounding box.`);
    let readyAt = this.now();
    let landing;
    let approachStart;
    if (step.action !== 'focus') {
      landing = targetPoint(box, index);
      // The hand may already be here, having moved during the previous rest: that stroke is the approach.
      // If the layout shifted a little meanwhile, it clicks where it rests, as a person would, rather
      // than making a second, corrective stroke.
      if (this.approach?.selector === step.selector && containsPoint(box, this.pointer)) {
        landing = this.pointer;
        approachStart = this.approach.start;
        readyAt = Math.min(readyAt, approachStart);
      }
      await this.moveTo(landing, Math.min(box.width, box.height));
    }
    this.approach = null;

    const context = await locator.evaluate(targetContext);
    const label = step.action === 'click'
      ? await locator.evaluate(element => (element.innerText || element.value || element.getAttribute('aria-label') || '').slice(0, 60))
      : '';

    const focus = {
      t: this.now(),
      readyAt,
      end: this.now(),
      action: step.action,
      context,
      manual: step.action === 'focus',
      approachStart,
      ...box,
    };
    this.timeline.focuses.push(focus);
    return { locator, focus, landing, commit: commitLabel.test(label) };
  }

  async click(locator, focus, index, landing, watch, commit) {
    await sleep(clickSettleDelay(index, this.difficulty, commit) * 1000);
    await locator.click({ trial: true });
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Step ${index + 1}: target has no bounding box.`);
    const target = containsPoint(box, landing) ? landing : targetPoint(box, index);
    if (Math.hypot(target.x - this.pointer.x, target.y - this.pointer.y) > 2) {
      await this.moveTo(target, Math.min(box.width, box.height));
    }

    Object.assign(focus, box);
    const click = { t: this.now(), ...this.pointer };
    this.timeline.clicks.push(click);
    if (watch) await this.page.evaluate(watchChanges);
    await this.page.mouse.down();
    await sleep(clickHold(index) * 1000);
    await this.page.mouse.up();
    click.up = this.now();
  }

  async type(locator, text, focus, index) {
    const focused = await locator.evaluate(element => element === document.activeElement || element.contains(document.activeElement));
    if (!focused) await locator.focus();
    await sleep(homingDelay(index) * 1000);
    focus.typingStart = this.now();
    const filled = await locator.evaluate(element => (element.isContentEditable ? element.textContent : element.value ?? '').length > 0);
    if (filled) {
      // Select the old text and type over it: the highlight shows for a moment, as when a person does it.
      await this.page.keyboard.press('ControlOrMeta+A');
      await sleep(180 + 100 * unitNoise(index * 379 + 9));
    }
    focus.carets = [];
    const characters = [...text];
    const delays = typingDelays(text, this.movementIndex);
    const beginning = performance.now();
    let due = 0;
    for (const [index, character] of characters.entries()) {
      if (index) due += delays[index];
      await sleep(Math.max(0, due - (performance.now() - beginning)));
      await this.page.keyboard.type(character);
      // Word boundaries are enough for the camera to follow text across a wide field.
      if (/\s/.test(character) || index === characters.length - 1) {
        const caret = await locator.evaluate(caretPoint);
        if (caret) focus.carets.push({ t: this.now(), ...caret });
      }
    }
  }

  async scroll(step) {
    const duration = step.duration ?? Math.min(2.6, 0.65 + Math.abs(step.y) / 1100);
    const scroll = { start: this.now(), automatic: false };
    (this.timeline.scrolls ??= []).push(scroll);
    const beginning = performance.now();
    let previous = 0;
    let progress = 0;
    let tick = 1;
    while (progress < 1) {
      await sleep(Math.max(0, tick * 1000 / 60 - (performance.now() - beginning)));
      progress = duration > 0 ? Math.min(1, (performance.now() - beginning) / (duration * scrollSlowdown * 1000)) : 1;
      // A wheel flick departs quickly and glides to rest rather than easing symmetrically.
      const next = step.y * ease(progress ** 0.75);
      await this.page.mouse.wheel(0, next - previous);
      previous = next;
      tick = Math.max(tick + 1, Math.ceil((performance.now() - beginning) * 60 / 1000));
    }
    (this.timeline.slowMotion ??= []).push({ start: scroll.start, end: this.now(), factor: scrollSlowdown });
    // Wheel dispatch precedes compositor presentation; retain the settling frames.
    await sleep(100);
    scroll.end = this.now();
    await this.captureCursor(true);
  }

  // A key pressed into the previous step's element (Enter in a field) shows its result there too.
  attachResult(step, focus, box) {
    const owner = focus ?? (step.action === 'press' ? this.previousFocus : null);
    if (owner && !owner.manual) owner.result = { t: this.now(), ...box };
  }

  async resultContains(selector, nextStep) {
    try {
      const next = await this.uniqueHandle(nextStep?.selector);
      if (!next) return false;
      const result = await this.page.locator(selector).first().elementHandle();
      const inside = await result.evaluate((element, other) => element.contains(other), next);
      await Promise.all([next.dispose(), result.dispose()]);
      return inside;
    } catch {
      return false;
    }
  }

  async run(step, index, nextStep) {
    const afterTyping = step.action === 'type' || (step.action === 'press' && this.previousFocus?.action === 'type');
    const { locator, focus, landing, commit } = await this.resolveTarget(step, index, nextStep);
    const actionStart = this.now();

    if (step.action === 'click' || step.action === 'type') {
      const alreadyFocused = step.action === 'type' && await locator.evaluate(element => element === document.activeElement);
      if (!alreadyFocused) await this.click(locator, focus, index, landing, step.action === 'click' && !step.expect, commit);
      await this.captureCursor(true);
    }

    if (step.action === 'type') {
      await this.type(locator, step.text, focus, index);
    } else if (step.action === 'scroll') {
      await this.scroll(step);
    } else if (step.action === 'press') {
      (this.timeline.keys ??= []).push({ t: this.now(), key: step.key });
      if (!step.expect) await this.page.evaluate(watchChanges);
      await this.page.keyboard.press(step.key);
    } else if (step.action === 'wait' || step.action === 'focus') {
      await sleep((step.duration ?? 1.5) * 1000);
    }

    const interactionEnd = this.now();
    if (focus) focus.interactionEnd = interactionEnd;
    let resultWords = 0;
    let inside = false;
    if (step.expect) {
      const result = this.page.locator(step.expect).first();
      await result.waitFor({ state: 'visible' });
      // Measure once it stops moving: a drawer or toast that slides in is first seen off to the side.
      await result.evaluate(waitForStableTarget);
      const info = await result.evaluate(resultInfo);
      resultWords = info.words;
      this.attachResult(step, focus, info.box);
      inside = await this.resultContains(step.expect, nextStep);
    } else if (step.action === 'click' || step.action === 'press') {
      // Let menus and transitions finish before the next gesture, as a presenter would.
      const changed = await this.page.evaluate(waitForSettled, { limit: 600 }).catch(async error => {
        if (!/context was destroyed|navigat/i.test(error.message)) throw error;
        await this.page.waitForLoadState('load');
        return this.page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }));
      });
      if (changed) this.attachResult(step, focus, changed);
    }
    const expectationEnd = this.now();
    if (focus) focus.end = expectationEnd;
    this.previousFocus = focus ?? null;
    const pause = pauseAfter(step, nextStep, resultWords, index, inside);
    await this.rest(pause, nextStep, index, afterTyping);
    return { actionStart, interactionEnd, expectationEnd, pause };
  }
}
