const pauses = {
  click: 0.42,
  type: 0.45,
  scroll: 0.45,
  press: 0.3,
  focus: 0.2,
  wait: 0.15,
};

export function pauseAfter(step, nextStep) {
  if (step.pause !== undefined) return step.pause;
  if (step.expect) return 0.55;
  if (step.action === 'click' && nextStep?.action === 'click') return 0.36;
  if (step.action === 'click' && nextStep?.action === 'type') return 0.32;
  return pauses[step.action] ?? 0.35;
}

export function movementDuration(distance, targetWidth = 40, cadence = 0) {
  const difficulty = Math.log2(1 + distance / Math.max(18, targetWidth));
  return Math.max(0.28, Math.min(1.2, 0.18 + 0.16 * difficulty + cadence * 0.045));
}

export function clickSettleDelay(index) {
  return 0.12 + ((index * 37 + 11) % 7) * 0.01;
}

export function typingDelay(character, index) {
  // Deterministic variation makes exports reproducible without a repeating five-key rhythm.
  const variation = (character.codePointAt(0) * 31 + index * 17) % 37;
  let boundary = 0;
  if (/[.,:;!?]/.test(character)) boundary = 95;
  else if (/\s/.test(character)) boundary = 30;
  return 32 + variation + boundary;
}
