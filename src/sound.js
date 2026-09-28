// A quiet film-advance click for leafing through a roll: two short filtered noise ticks, the lever
// and the ratchet. Synthesised, so there is no file to load. Browsers only allow sound after a
// click or key press, so unlock() is called from the click that opens a roll.
let ctx = null, noise = null, last = 0;
let on = true;
try { on = localStorage.getItem('photographi-sound') !== 'off'; } catch (e) {}

export function unlock() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    ctx = new C();
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * .05), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tick(t, gain, freq) {
  const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  band.type = 'bandpass'; band.frequency.value = freq; band.Q.value = 1.4;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(.0001, t + .03);
  src.connect(band).connect(g).connect(ctx.destination);
  src.start(t); src.stop(t + .04);
}

export function click() {
  if (!on || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  if (t - last < .045) return;               // leafing fast gives a purr, not a machine gun
  last = t;
  tick(t, .12, 2600);
  tick(t + .032, .06, 1800);
}

// a stack of prints set down on a table: low and soft, twice
export function thud() {
  if (!on || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  last = t;
  tick(t, .16, 420);
  tick(t + .07, .09, 260);
}

export const soundOn = () => on;
export function setSound(v) {
  on = v;
  try { localStorage.setItem('photographi-sound', v ? 'on' : 'off'); } catch (e) {}
  if (v) unlock();
}
