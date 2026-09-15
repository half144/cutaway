import { setTimeout as sleep } from 'node:timers/promises';
import { ease, pointerPath } from '../motion.mjs';
import { movementDuration, pauseAfter, typingDelay } from './pacing.mjs';
import { cursorAtPoint, targetContext, targetNeedsScroll, waitForStableTarget } from './page-state.mjs';

export class ActionRunner {
  constructor(page, timeline, now, pointer) {
    this.page = page;
    this.timeline = timeline;
    this.now = now;
    this.pointer = pointer;
    this.cursorSampleAt = -Infinity;
  }

  async captureCursor(force = false) {
    const t = this.now();
    if (!force && t - this.cursorSampleAt < 0.1) return;
    this.cursorSampleAt = t;
    const type = await this.page.evaluate(cursorAtPoint, this.pointer);
    const cursors = this.timeline.cursors ??= [];
    if (cursors.at(-1)?.type !== type) cursors.push({ t, type });
  }

  async moveTo(target, targetWidth) {
    const distance = Math.hypot(target.x - this.pointer.x, target.y - this.pointer.y);
    if (distance <= 2) return;
    const duration = movementDuration(distance, targetWidth);
    const beginning = performance.now();
    this.timeline.points.push({ t: this.now(), ...this.pointer });

    const path = pointerPath(this.pointer, target, duration);
    for (let i = 1; i < path.length; i++) {
      // Skip overdue samples instead of replaying a burst when the browser is busy.
      while (i + 1 < path.length && path[i + 1].t * 1000 < performance.now() - beginning) i++;
      const point = path[i];
      await sleep(Math.max(0, point.t * 1000 - (performance.now() - beginning)));
      await this.page.mouse.move(point.x, point.y);
      this.timeline.points.push({ t: this.now(), x: point.x, y: point.y });
      this.pointer = { x: point.x, y: point.y };
      await this.captureCursor();
    }

    this.pointer = target;
    await this.captureCursor(true);
  }

  async resolveTarget(step, index) {
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
      await locator.evaluate(element => element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }));
      await locator.evaluate(waitForStableTarget);
      scroll.end = this.now();
    }

    if (step.action !== 'focus') await locator.click({ trial: true });
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Step ${index + 1}: target has no bounding box.`);
    const readyAt = this.now();
    if (step.action !== 'focus') {
      await this.moveTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, Math.min(box.width, box.height));
    }

    const context = await locator.evaluate(targetContext);

    const focus = {
      t: this.now(),
      readyAt,
      end: this.now(),
      action: step.action,
      context,
      manual: step.action === 'focus',
      ...box,
    };
    this.timeline.focuses.push(focus);
    return { locator, focus };
  }

  async click(locator, focus, index) {
    await sleep(80);
    await locator.click({ trial: true });
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Step ${index + 1}: target has no bounding box.`);
    const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (Math.hypot(target.x - this.pointer.x, target.y - this.pointer.y) > 2) {
      await this.moveTo(target);
    }

    Object.assign(focus, box);
    this.timeline.clicks.push({ t: this.now(), ...this.pointer });
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
  }

  async type(locator, text) {
    await locator.press('ControlOrMeta+A');
    await locator.press('Backspace');
    await sleep(140);
    let charIndex = 0;
    for (const character of text) {
      await locator.pressSequentially(character);
      await sleep(typingDelay(character, charIndex++));
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
      progress = duration > 0 ? Math.min(1, (performance.now() - beginning) / (duration * 1000)) : 1;
      const next = step.y * ease(progress);
      await this.page.mouse.wheel(0, next - previous);
      previous = next;
      tick = Math.max(tick + 1, Math.ceil((performance.now() - beginning) * 60 / 1000));
    }
    // Wheel dispatch precedes compositor presentation; retain the settling frames.
    await sleep(100);
    scroll.end = this.now();
    await this.captureCursor(true);
  }

  async run(step, index, nextStep) {
    const { locator, focus } = await this.resolveTarget(step, index);
    const actionStart = this.now();

    if (step.action === 'click' || step.action === 'type') {
      const alreadyFocused = step.action === 'type' && await locator.evaluate(element => element === document.activeElement);
      if (!alreadyFocused) await this.click(locator, focus, index);
      await this.captureCursor(true);
    }

    if (step.action === 'type') {
      await this.type(locator, step.text);
    } else if (step.action === 'scroll') {
      await this.scroll(step);
    } else if (step.action === 'press') {
      await this.page.keyboard.press(step.key);
    } else if (step.action === 'wait' || step.action === 'focus') {
      await sleep((step.duration ?? 1.5) * 1000);
    }

    const interactionEnd = this.now();
    if (focus) focus.interactionEnd = interactionEnd;
    if (step.expect) await this.page.locator(step.expect).waitFor({ state: 'visible' });
    const expectationEnd = this.now();
    if (focus) focus.end = expectationEnd;
    const pause = pauseAfter(step, nextStep);
    await sleep(pause * 1000);
    return { actionStart, interactionEnd, expectationEnd, pause };
  }
}
