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
  return box.top < 0 || box.left < 0 || box.bottom > innerHeight || box.right > innerWidth;
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
