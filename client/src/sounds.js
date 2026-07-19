/** Tiny UI sounds via Web Audio API (no asset files). */

let ctx = null;
let muted = false;

export function setMuted(v) {
  muted = !!v;
  try {
    localStorage.setItem('antidote_mute', muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getMuted() {
  try {
    if (localStorage.getItem('antidote_mute') === '1') return true;
  } catch {
    /* ignore */
  }
  return muted;
}

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function beep(freq, dur, type = 'sine', gain = 0.04) {
  if (muted || getMuted()) return;
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur);
  } catch {
    /* ignore */
  }
}

export const sfx = {
  discard: () => beep(180, 0.08, 'triangle', 0.05),
  receive: () => {
    beep(420, 0.06, 'sine', 0.035);
    setTimeout(() => beep(520, 0.07, 'sine', 0.03), 50);
  },
  end: () => {
    beep(330, 0.12, 'sine', 0.05);
    setTimeout(() => beep(440, 0.15, 'sine', 0.04), 100);
    setTimeout(() => beep(550, 0.2, 'sine', 0.035), 220);
  },
  click: () => beep(600, 0.04, 'square', 0.02),
};
