// These functions execute inside the page via Playwright; keep them self-contained.
export function cursorAtPoint(point) {
  const element = document.elementFromPoint(point.x, point.y);
  if (!element) return 'arrow';
  const style = getComputedStyle(element).cursor;
  if (style === 'text' || style === 'vertical-text') return 'text';
  if (style === 'pointer') return 'hand';
  if (style === 'auto' && element.matches('textarea, input:not([type=button]):not([type=checkbox]):not([type=radio]), [contenteditable=true]')) return 'text';
  return 'arrow';
}

export function targetNeedsScroll(element) {
  const box = element.getBoundingClientRect();
  // Scrolling cannot bring a fixed or stuck element closer; only move the page if it is out of view.
  for (let node = element; node; node = node.parentElement) {
    if (/fixed|sticky/.test(getComputedStyle(node).position)) {
      return box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth;
    }
  }
  return box.top < 8 || box.left < 0 || box.bottom > innerHeight - 8 || box.right > innerWidth;
}

// Glides the target's scroll container so the target (and the next target, when both fit) rests
// a little above the middle, instead of snapping it to an edge as `block: 'nearest'` does.
export async function scrollIntoComfort([element, companion]) {
  function scroller(node) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) return parent;
    }
    return document.scrollingElement;
  }
  const container = scroller(element);
  const frame = container === document.scrollingElement
    ? { top: 0, bottom: innerHeight } : container.getBoundingClientRect();
  const top = Math.max(0, frame.top);
  const view = Math.min(innerHeight, frame.bottom) - top;
  const box = element.getBoundingClientRect();
  let start = box.top;
  let end = box.bottom;
  if (companion && scroller(companion) === container) {
    const other = companion.getBoundingClientRect();
    if (Math.max(end, other.bottom) - Math.min(start, other.top) <= view * 0.8) {
      start = Math.min(start, other.top);
      end = Math.max(end, other.bottom);
    }
  }
  const limit = container.scrollHeight - container.clientHeight;
  const from = container.scrollTop;
  // A span taller than the view is read from its beginning.
  const offset = end - start > view * 0.9 ? start - top - 24 : (start + end) / 2 - (top + view * 0.45);
  const to = Math.max(0, Math.min(limit, from + offset));
  const distance = to - from;
  if (Math.abs(distance) < 1) return;
  // Longer distances take longer, but sublinearly, like Chromium's programmatic smooth scroll.
  const duration = Math.min(1.3, 0.45 + Math.sqrt(Math.abs(distance)) / 45) * 1000;
  // Quick departure and a long glide into place, like a wheel flick coming to rest.
  const curve = t => {
    const s = t ** 0.75;
    return s * s * s * (10 + s * (-15 + s * 6));
  };
  await new Promise(resolve => {
    const beginning = performance.now();
    function step(now) {
      const progress = Math.min(1, (now - beginning) / duration);
      container.scrollTo({ top: from + distance * curve(progress), behavior: 'instant' });
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

export function waitForStableTarget(element) {
  return new Promise(resolve => {
    const beginning = performance.now();
    let previous = element.getBoundingClientRect();
    let stable = 0;
    function check() {
      const box = element.getBoundingClientRect();
      stable = Math.abs(box.x - previous.x) + Math.abs(box.y - previous.y) < 0.1 ? stable + 1 : 0;
      previous = box;
      if ((performance.now() - beginning > 100 && stable >= 4) || performance.now() - beginning > 2000) resolve();
      else requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
}

// Resolves once the interface stops changing: no DOM mutations for a moment and no finite
// animations running. A presenter lets a menu finish opening before moving to it.
// Starts watching for visible changes just before a click or key press, so reactions to pointer-down
// are seen. Each changed element is measured when it changes, while a closing panel is still on screen.
export function watchChanges() {
  const root = document.documentElement;
  const watch = window.__agentScreenChanges = { lastChange: performance.now(), box: null, elements: [], seen: new WeakSet() };
  watch.measure = element => {
    const box = element.getBoundingClientRect();
    const left = Math.max(0, box.left), top = Math.max(0, box.top);
    const right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    if (right - left < 1 || bottom - top < 1) return;
    const previous = watch.box ?? { left, top, right, bottom };
    watch.box = { left: Math.min(previous.left, left), top: Math.min(previous.top, top),
      right: Math.max(previous.right, right), bottom: Math.max(previous.bottom, bottom) };
  };
  function include(element) {
    // Libraries toggle styles on <html>/<body> to lock scrolling; that is not a visible change.
    if (!element || element === root || element === document.body || watch.seen.has(element)) return;
    watch.seen.add(element);
    watch.elements.push(element);
    watch.measure(element);
  }
  watch.observer = new MutationObserver(records => {
    watch.lastChange = performance.now();
    for (const record of records) {
      include(record.target.nodeType === 1 ? record.target : record.target.parentElement);
      for (const node of record.addedNodes) if (node.nodeType === 1) include(node);
    }
  });
  // Visual attributes only: modal libraries mark the rest of the page aria-hidden, which changes nothing on screen.
  watch.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'd', 'points', 'transform', 'width', 'height', 'x', 'y', 'src', 'data-state'] });
}

// Resolves once the interface stops changing (no DOM mutations for a moment and no finite animations
// running) with the region that changed, so the camera can tell a local effect (a menu, a checkbox)
// from one that fills the screen (a chart redrawing, a panel opening). A presenter lets a menu finish
// opening before moving to it.
export function waitForSettled({ limit, quiet = 120 }) {
  const watch = window.__agentScreenChanges;
  return new Promise(resolve => {
    const beginning = performance.now();
    function check() {
      const now = performance.now();
      const animating = document.getAnimations().some(animation => animation.playState === 'running'
        && animation.effect?.getComputedTiming().iterations !== Infinity);
      if ((now - watch.lastChange > quiet && !animating) || now - beginning > limit) {
        watch.observer.disconnect();
        // Popovers mount before they are positioned: measure what is still on screen once it settled.
        for (const element of watch.elements) if (element.isConnected) watch.measure(element);
        const box = watch.box;
        resolve(box && { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top });
      } else {
        requestAnimationFrame(check);
      }
    }
    requestAnimationFrame(check);
  });
}

export function caretPoint(element) {
  if (element.isContentEditable) {
    const selection = getSelection();
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return rect.height ? { x: rect.right, y: rect.top, height: rect.height } : null;
  }
  if (typeof element.selectionEnd !== 'number') return null;
  // Mirror technique: lay out the text before the caret with the field's typography.
  const style = getComputedStyle(element);
  const mirror = document.createElement('div');
  for (const property of ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
    'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant',
    'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
    'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize']) {
    mirror.style[property] = style[property];
  }
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', borderStyle: 'solid',
    whiteSpace: element.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', overflowWrap: 'break-word',
  });
  mirror.textContent = element.value.slice(0, element.selectionEnd);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  document.body.append(mirror);
  const box = element.getBoundingClientRect();
  const height = marker.offsetHeight || parseFloat(style.fontSize) * 1.2;
  const x = box.left + parseFloat(style.borderLeftWidth) + marker.offsetLeft - element.scrollLeft;
  const y = box.top + parseFloat(style.borderTopWidth) + marker.offsetTop - element.scrollTop;
  mirror.remove();
  return {
    x: Math.min(Math.max(x, box.left), box.right),
    y: Math.min(Math.max(y, box.top), box.bottom - height),
    height,
  };
}

// Viewers catch a result's headline, not the whole panel: count the words of its heading (or label).
export function resultInfo(element) {
  const box = element.getBoundingClientRect();
  const headline = element.querySelector('h1, h2, h3, h4, [role=heading], legend')?.innerText
    ?? element.getAttribute('aria-label') ?? element.innerText ?? '';
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    words: Math.min(12, headline.trim().split(/\s+/).filter(Boolean).length),
  };
}

// A resting spot that shows nothing on hover: no control, link, field, tooltip trigger or chart
// under it. A pointer parked on a chart opens a tooltip before the video has even begun.
export function isQuietSpot(point) {
  const element = document.elementFromPoint(point.x, point.y);
  if (!element) return false;
  const busy = 'a, button, input, select, textarea, label, summary, svg, canvas, video, iframe, [title], [data-state], '
    + '[role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=slider], [role=switch]';
  return !element.closest(busy) && getComputedStyle(element).cursor !== 'pointer';
}

export function targetContext(element) {
  const target = element.getBoundingClientRect();
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const box = parent.getBoundingClientRect();
    if (box.width > innerWidth * 0.65 || box.height > innerHeight * 0.6) break;
    if (box.width >= target.width && box.height >= target.height + 16
      && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight) {
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
  }
  return null;
}
