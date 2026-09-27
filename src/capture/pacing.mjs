import { clamp, unitNoise } from '../motion.mjs';

const pauses = {
  click: 0.4,
  type: 0.45,
  scroll: 0.45,
  press: 0.4,
  focus: 0.25,
  wait: 0.15,
};

// A standard normal sample, deterministic per seed so a plan records the same way twice.
export function gaussian(seed) {
  const u = Math.max(1e-6, unitNoise(seed * 2 + 1));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * unitNoise(seed * 2 + 2));
}

const lognormal = (median, sigma, seed) => median * Math.exp(sigma * gaussian(seed));

// A person doesn't pause the same amount after every action; a fixed beat reads as a metronome.
function vary(seconds, index) {
  return seconds * (0.7 + 0.6 * unitNoise(index * 7907 + 13));
}

// `inside`: the next step acts on the result that just appeared, so there is no need to linger.
export function pauseAfter(step, nextStep, resultWords = 0, index = 0, inside = false) {
  if (step.pause !== undefined) return step.pause;
  if (step.expect && inside) return vary(0.42, index);
  // Long enough to register the change and catch its headline; viewers don't read a whole panel.
  if (step.expect) return clamp(0.6 + 0.15 * resultWords, 0.8, 1.6);
  if (step.action === 'click' && nextStep?.action === 'click') return vary(0.35, index);
  if (step.action === 'click' && nextStep?.action === 'type') return vary(0.28, index);
  return vary(pauses[step.action] ?? 0.4, index);
}

// Fitts' law for a skilled presenter (lab mouse pointing is ~0.1 s + 0.2 s/bit, done as fast as
// possible), with a floor that keeps peak speed readable on long strokes.
// `jitter` is a standard normal sample: people's stroke times scatter lognormally around Fitts' law.
export function movementDuration(distance, targetWidth = 40, jitter = 0) {
  const fitts = 0.12 + 0.14 * pointingDifficulty(distance, targetWidth);
  return clamp(Math.max(fitts, distance / 1100) * clamp(Math.exp(0.15 * jitter), 0.75, 1.35), 0.3, 1.05);
}

export function pointingDifficulty(distance, targetWidth = 40) {
  return Math.log2(1 + distance / Math.max(18, targetWidth));
}

// Verifying the aim before pressing: longer for small, far targets, and a person pauses a beat before
// committing (save, delete). Lognormal like human reaction times, never a fixed beat.
export function clickSettleDelay(index, difficulty = 0, commit = false) {
  return clamp(lognormal(0.12, 0.35, index * 131 + 7) + 0.05 * Math.max(0, difficulty - 3) + (commit ? 0.15 : 0), 0.07, 0.45);
}

// People hold a mouse button for ~100–120 ms; automation's instant release reads as synthetic.
export function clickHold(index) {
  return clamp(lognormal(0.105, 0.2, index * 173 + 3), 0.07, 0.16);
}

// The hand travels from the mouse to the keyboard before the first key (KLM homing, ~0.4 s).
export function homingDelay(index) {
  return 0.25 + 0.2 * unitNoise(index * 211 + 5);
}

// Skilled typing has lognormal inter-key intervals, a slower first key per word, pauses after
// punctuation and the odd hesitation mid-word. ~105 WPM stays readable; much faster reads as autofill.
export function typingDelays(text, seed = 0) {
  const characters = [...text];
  return characters.map((character, index) => {
    let delay = lognormal(90, 0.42, seed * 7919 + index);
    const previous = characters[index - 1];
    if (previous === undefined || /\s/.test(previous)) delay *= 1.5;
    else if (/\w/.test(previous) && unitNoise(seed * 6007 + index) < 0.04) delay += 180 + 220 * unitNoise(seed * 6011 + index);
    if (/[,;:]/.test(previous)) delay += 260;
    if (/[.!?]/.test(previous)) delay += 480;
    return clamp(delay, 45, 900);
  });
}
