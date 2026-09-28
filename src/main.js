import * as THREE from 'three';
import { developPlaceholders, fileToPhoto } from './placeholders.js';
import { createCanvas } from './canvas.js';
import { unlock, click as tick, thud, soundOn, setSound } from './sound.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

/* ---------- renderer + pointer ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#stage').appendChild(renderer.domElement);
const el = renderer.domElement;

const ptr = { nx: 0, ny: 0, inside: false, down: false, lx: 0, ly: 0, moved: 0, lastMove: 0 };
const pointers = new Map();
let pinchD = 0;

/* ---------- the canvas ---------- */
const frame = { t: $('.f-t'), b: $('.f-b'), l: $('.f-l'), r: $('.f-r') };
const world = createCanvas({
  ptr, reduced,
  frameRect: () => ({ x0: frame.l.offsetWidth, x1: innerWidth - frame.r.offsetWidth, y0: frame.t.offsetHeight, y1: innerHeight - frame.b.offsetHeight }),
  onFocus: showInfo,
  onUnfocus: () => document.body.classList.remove('focused'),
});

/* ---------- data ---------- */
// photos/photos.json: [{ src, full?, w, h, stock, frame, tags: [], color: "#rrggbb" }]
let photos = [], tag = 'all';
async function loadManifest() {
  try {
    const r = await fetch('photos/photos.json', { cache: 'no-store' });
    if (!r.ok) return [];
    const list = await r.json();
    return list.filter(p => !p.hidden).map(p => ({ ...p, aspect: p.w / p.h, frame: String(p.frame ?? ''), stock: p.stock || '', tags: p.tags || [], color: p.color || '#888888', tex: null, ready: false }));
  } catch (e) { return []; }
}
const filtered = () => tag === 'all' ? photos : photos.filter(p => p.tags.includes(tag));

/* ---------- rolls: every photo in shooting order ---------- */
// "12A" sits between 12 and 13
const frameNo = f => (parseInt(f, 10) || 0) + (/a$/i.test(f) ? .5 : 0);
let rollSeq = [], gridTag = 'all';
// Every roll in shooting order, one after the other. Between two rolls sits a divider: a pause
// where the stack you went through is put down and the next one waits under its title.
function buildRolls() {
  // A roll is its full name (number, year, stock: "18-2016-hp5at800"), not its number: the
  // numbers start over every year. Rolls follow each other in the order they were shot.
  const rid = p => p.key ? p.key.replace(/-[^-]+$/, '') : String(p.roll);
  const shot = photos.filter(p => p.roll != null).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || a.roll - b.roll || rid(a).localeCompare(rid(b)) ||
    frameNo(a.frame) - frameNo(b.frame) || (a.version || 1) - (b.version || 1));
  const by = new Map();
  shot.forEach(p => { const k = rid(p); if (!by.has(k)) by.set(k, []); by.get(k).push(p); });
  by.forEach(list => list.forEach((p, i) => { p.inRoll = i; p.rollLen = list.length; }));
  rollSeq = [];
  [...by.values()].forEach((list, k) => {
    const f = list[0];
    if (k) rollSeq.push({ divider: true, roll: f.roll, len: list.length, stock: f.stock, dev: f.dev, date: f.date, first: f });
    rollSeq.push(...list);
  });
  return by.size;
}
let rollCount = 0;

/* ---------- worlds: tags that open a place of their own ---------- */
// Phosphor icons (MIT, phosphoricons.com), regular weight: its stroke sits closest to Switzer 400.
const ICON = {
  rolls: 'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,88h80v80H40Zm96-16V56h32V72Zm-16,0H88V56h32Zm0,112v16H88V184Zm16,0h32v16H136Zm0-16V88h80v80Zm80-96H184V56h32ZM72,56V72H40V56ZM40,184H72v16H40Zm176,16H184V184h32v16Z',
  people: 'M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z',
  water: 'M222.16,177.25a8,8,0,0,1-1,11.25c-17.36,14.39-32.86,19.5-47,19.5-18.58,0-34.82-8.82-49.93-17-25.35-13.76-47.24-25.64-79.07.74a8,8,0,1,1-10.22-12.31c40.17-33.28,70.32-16.92,96.93-2.48,25.35,13.75,47.24,25.63,79.07-.74A8,8,0,0,1,222.16,177.25Zm-11.27-57c-31.83,26.38-53.72,14.5-79.07.74-26.61-14.43-56.76-30.79-96.93,2.49a8,8,0,0,0,10.22,12.31c31.83-26.38,53.72-14.5,79.07-.74,15.11,8.19,31.35,17,49.93,17,14.14,0,29.64-5.11,47-19.5a8,8,0,1,0-10.22-12.31ZM45.11,79.8c31.83-26.37,53.72-14.49,79.07-.74,15.11,8.2,31.35,17,49.93,17,14.14,0,29.64-5.12,47-19.5a8,8,0,1,0-10.22-12.31c-31.83,26.38-53.72,14.5-79.07.74C105.21,50.58,75.06,34.22,34.89,67.5A8,8,0,1,0,45.11,79.8Z',
  interior: 'M232,216H208V40a16,16,0,0,0-16-16H64A16,16,0,0,0,48,40V216H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16Zm-40,0H176V40h16ZM64,40h96V216H64Zm80,92a12,12,0,1,1-12-12A12,12,0,0,1,144,132Z',
};
const WORLD = { people: 'globe', water: 'drift', interior: 'interior' };
const isWorld = t => t in ICON;
const mode = t => WORLD[t] || null;

/* ---------- tags ---------- */
const top = $('#top'), nav = $('#tagwrap'), tagsEl = $('#tags'), filterBtn = $('#filterBtn');
function renderTags() {
  const counts = new Map();
  photos.forEach(p => p.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // three groups, set apart by space: all, then the tags that open a view of their own, then the rest
  const worlds = [...(rollCount ? [['rolls', rollCount]] : []), ...sorted.filter(([t]) => isWorld(t))];
  const rows = [['all', photos.length], ...worlds, ...sorted.filter(([t]) => !isWorld(t))];
  const first = new Set([worlds[0]?.[0], sorted.find(([t]) => !isWorld(t))?.[0]]);
  tagsEl.innerHTML = rows.map(([t, c]) => `<li${first.has(t) ? ' class="g"' : ''}>` + (isWorld(t)
    ? `<button class="world" data-tag="${t}" aria-pressed="${t === tag}" aria-label="${t} ${c}, opens its own view"><span class="wl">${[...t].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}</span><svg class="wi" viewBox="0 0 256 256" aria-hidden="true"><path d="${ICON[t]}"/></svg><span class="c">${c}</span></button>`
    : `<button data-tag="${t}" aria-pressed="${t === tag}"><span class="wl">${t}</span><span class="c">${c}</span></button>`) + '</li>').join('');
}
function setOpen(open) {
  top.classList.toggle('open', open);
  filterBtn.setAttribute('aria-expanded', open);
  filterBtn.textContent = open ? 'close' : 'filter';
}
function setTag(t) {
  if (t === 'rolls' || t.startsWith('rolls/')) return enterRolls(t.slice(6));
  if (!photos.some(p => p.tags.includes(t))) t = 'all';
  setOpen(false);
  if (tag === 'rolls') {
    leaveRolls();
    if (t === gridTag) return;
  }
  if (t === tag) return;
  tag = t;
  renderTags();
  world.setList(filtered(), mode(t));
  setHint();
  try { history.replaceState(null, '', t === 'all' ? location.pathname : '#' + encodeURIComponent(t)); } catch (e) {}
}
tagsEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTag(b.dataset.tag); });
filterBtn.addEventListener('click', () => setOpen(!top.classList.contains('open')));

function enterRolls(key, from) {
  if (!rollSeq.length || (world.rolling && !key && !from)) return setOpen(false);
  unlock();
  let i = from ? rollSeq.indexOf(from) : key ? rollSeq.findIndex(p => p.key === key) : -1;
  if (i < 0) {
    // from the nav: the first frame of a roll picked at random, like the canvas entry
    const starts = rollSeq.map((p, j) => p.inRoll === 0 ? j : -1).filter(j => j >= 0);
    i = starts[Math.floor(Math.random() * starts.length)];
  }
  setOpen(false);
  if (tag !== 'rolls') gridTag = tag;
  tag = 'rolls';
  renderTags();
  document.body.classList.add('rolling');
  if (world.rolling) world.rollTo(i); else world.enterRoll(rollSeq, i, onRollFrame);
}
function leaveRolls() {
  world.leaveRoll();
  document.body.classList.remove('rolling');
  tag = gridTag;
  renderTags();
  try { history.replaceState(null, '', tag === 'all' ? location.pathname : '#' + encodeURIComponent(tag)); } catch (e) {}
}
// a roll is named by the year it was shot and its number that year: "Roll 2016/10"
const rollName = p => `Roll ${String(p.date || '').slice(0, 4) || '?'}/${String(p.roll).padStart(2, '0')}`;
function onRollFrame(i, p) {
  document.body.classList.toggle('at-divider', !!p.divider);
  if (p.divider) {
    // the old stack goes down on the table; the panel already speaks of the one waiting
    thud();
    $('#rName').textContent = rollName(p);
    $('#rCount').textContent = `${p.len} photos`;
    $('#rStock').textContent = p.stock;
    $('#rDev').textContent = p.dev ? p.dev[0].toUpperCase() + p.dev.slice(1) : '';
    $('#rDate').textContent = formatDate(p.date);
    $('#rNum').textContent = '';
    $('#bT').textContent = rollName(p);
    $('#bM').textContent = [formatDate(p.date), p.stock, `${p.len} photos`].filter(Boolean).join(' · ');
    try { history.replaceState(null, '', '#rolls/' + encodeURIComponent(p.first.key)); } catch (e) {}
    return;
  }
  tick();
  $('#rName').textContent = rollName(p);
  $('#rCount').textContent = `${String(p.inRoll + 1).padStart(String(p.rollLen).length, '0')} / ${p.rollLen}`;
  $('#rStock').textContent = p.stock;
  $('#rDev').textContent = p.dev ? p.dev[0].toUpperCase() + p.dev.slice(1) : '';
  $('#rDate').textContent = formatDate(p.date);
  $('#rNum').textContent = p.frame;
  try { history.replaceState(null, '', '#rolls/' + encodeURIComponent(p.key)); } catch (e) {}
}
// the first frame of the next roll, or of the previous one (a divider counts to the roll after it)
function rollJump(dir) {
  const firsts = rollSeq.map((p, j) => p.inRoll === 0 ? j : -1).filter(j => j >= 0);
  const at = world.rollAt + (rollSeq[world.rollAt]?.divider ? 1 : 0);
  const k = firsts.findLastIndex(j => j <= at);
  world.rollTo(firsts[clamp(k + dir, 0, firsts.length - 1)]);
}
$('#rPrev').addEventListener('click', () => rollJump(-1));
$('#rNext').addEventListener('click', () => rollJump(1));
const soundBtn = $('#rSound');
soundBtn.setAttribute('aria-pressed', soundOn());
soundBtn.addEventListener('click', () => { setSound(!soundOn()); soundBtn.setAttribute('aria-pressed', soundOn()); });
$('#toRoll').addEventListener('click', () => enterRolls(null, world.focused));

/* ---------- the glass lens that glides along the bar ---------- */
// A pill of milky glass follows the pointer from button to button, bending what is behind its rim.
// One lives in the side nav and glides down the list, one in the header for the theme switch.
const lens = $('#lens'), navLens = $('#navLens');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const chromium = !!navigator.userAgentData?.brands?.some(b => /Chromium/.test(b.brand));
if (chromium) {
  // displacement map: flat in the middle, pulling toward the centre near the rim, like a thick lens edge
  const W = 200, H = 48, R = H / 2, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const px = i + .5, py = j + .5;
    const qx = Math.max(R, Math.min(W - R, px));            // nearest point on the pill's spine
    let dx = px - qx, dy = py - R;
    const d = Math.hypot(dx, dy) || 1, edge = Math.max(0, (d - (R - 14)) / 14);   // 0 inside, 1 at the rim
    const k = edge * edge;
    const o = (j * W + i) * 4;
    img.data[o] = 128 - (dx / d) * k * 127; img.data[o + 1] = 128 - (dy / d) * k * 127; img.data[o + 2] = 128; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  $('#glassMap').setAttribute('href', c.toDataURL());
  lens.classList.add('refract');
}
let lensOn = null, lit = null;
function lensTo(b) {
  if (!b || !fine.matches) return lensOff();
  const inNav = nav.contains(b), L = inNav ? navLens : lens;
  if (lensOn && lensOn !== L) lensOff();
  const r = b.getBoundingClientRect(), o = inNav ? nav.getBoundingClientRect() : { left: 0, top: 0 };
  const px = 0, py = 0, w = Math.round(r.width), h = Math.round(r.height);   // the glass covers the item's chip
  if (lensOn !== L) L.style.transition = 'none';
  L.style.width = w + 'px'; L.style.height = h + 'px';
  L.style.transform = `translate3d(${Math.round(r.left - o.left - px)}px, ${Math.round(r.top - o.top - py)}px, 0)`;
  if (chromium) { const m = $('#glassMap'); m.setAttribute('width', w); m.setAttribute('height', h); }
  if (lensOn !== L) { L.offsetWidth; L.style.transition = ''; }
  L.classList.add('on'); lensOn = L;
  // the glass is always light, so whatever sits on it reads in dark ink, in either theme
  lit?.classList.remove('lit'); lit = b; b.classList.add('lit');
}
function lensOff() { lens.classList.remove('on'); navLens.classList.remove('on'); lensOn = null; lit?.classList.remove('lit'); lit = null; }
const LENSED = '.tags button';   // the theme toggle has its own glass, the thumb
// the nav sits inside the header in the markup, so the header hears both
top.addEventListener('pointerover', e => lensTo(e.target.closest(LENSED)));
top.addEventListener('pointerleave', lensOff);
top.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) lensTo(e.target.closest(LENSED)); });
top.addEventListener('focusout', lensOff);
addEventListener('resize', lensOff);

/* ---------- theme ---------- */
const themeBtns = document.querySelectorAll('[data-theme-set]'), thumb = $('#thumb');
// the thumb sits under the active word; the first placement and font swaps land without a slide
function placeThumb(slide) {
  const a = [...themeBtns].find(b => b.dataset.themeSet === root.dataset.theme);
  if (!a) return;
  if (!slide) thumb.style.transition = 'none';
  thumb.style.width = a.offsetWidth + 'px'; thumb.style.setProperty('--x', a.offsetLeft + 'px');
  if (!slide) { thumb.offsetWidth; thumb.style.transition = ''; }
}
function applyTheme(t, save) {
  const slide = !!root.dataset.theme && thumb.style.width !== '';
  root.dataset.theme = t;
  themeBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === t));
  placeThumb(slide);
  world.setBackground(getComputedStyle(root).getPropertyValue('--paper').trim());
  if (save) try { localStorage.setItem('photographi-theme', t); } catch (e) {}
}
// it is a toggle: pressing the word that is already on flips to the other one
themeBtns.forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.themeSet === root.dataset.theme ? (t0 => t0 === 'dark' ? 'light' : 'dark')(root.dataset.theme) : b.dataset.themeSet;
  applyTheme(t, true);
}));
document.fonts?.ready.then(() => placeThumb(false));
addEventListener('resize', () => placeThumb(false));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let saved = null; try { saved = localStorage.getItem('photographi-theme'); } catch (err) {}
  if (!saved) applyTheme(e.matches ? 'dark' : 'light');
});
applyTheme(root.dataset.theme || 'light');

/* ---------- a single photo in its frame ---------- */
// "2016-03" -> "March 2016"
function formatDate(d) {
  if (!d) return '';
  const [y, m] = String(d).split('-');
  return m ? `${new Date(+y, +m - 1).toLocaleString('en', { month: 'long' })} ${y}` : y;
}
function showInfo(p, i, n) {
  document.body.classList.add('focused');
  setOpen(false);
  $('#iNum').textContent = p.frame;
  $('#iStock').textContent = p.stock;
  $('#iDev').textContent = p.dev ? p.dev[0].toUpperCase() + p.dev.slice(1) : '';
  $('#iDate').textContent = formatDate(p.date);
  $('#iCount').textContent = `${String(i + 1).padStart(String(n).length, '0')} / ${n}`;
  $('#iTags').innerHTML = p.tags.map(t => `<button data-tag="${t}">${t}</button>`).join(', ');
  $('#toRoll').parentElement.hidden = p.roll == null || !rollSeq.length;
}
$('#iTags').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { world.escape(); setTag(b.dataset.tag); } });

/* ---------- input ---------- */
// the grid needs no instructions; the worlds say in a line how they move
const hint = $('#hint');
function setHint() {
  const m = mode(tag);
  if (m === 'globe') {
    const years = filtered().map(p => String(p.date).slice(0, 4)).filter(Boolean).sort();
    hint.textContent = `Drag to turn it. ${years[0]} at the top, ${years.at(-1)} at the bottom. Click a face.`;
  } else if (m === 'drift') hint.textContent = 'It drifts on its own. Drag or scroll to row along. Click a frame.';
  else if (m === 'interior') hint.textContent = 'Drag to turn around. Scroll to fold the room open into its plan.';
  else { hint.textContent = ''; return; }
  hint.classList.remove('gone');
}
const touched = () => hint.classList.add('gone');

/* ---------- the pointer in a detail view ---------- */
// Over the picture the pointer becomes one oversized mark: the left third of the photo window goes
// back, the middle closes, the right goes on. The strokes morph from one mark to the next.
const cur = $('#cur'), curW = $('#curW'), curP = $('#curP'), curL = $('#curL');
const ZONES = {
  prev: { d: 'M56 32L8 32M26 14L8 32L26 50', label: 'previous' },
  close: { d: 'M14 14L50 50M50 14L32 32L14 50', label: 'close' },
  next: { d: 'M8 32L56 32M38 14L56 32L38 50', label: 'next' },
};
const inDetail = () => !!world.focused || world.rolling;
function zoneAt(x) {
  if (!inDetail()) return null;
  const x0 = frame.l.offsetWidth, x1 = innerWidth - frame.r.offsetWidth, t = (x - x0) / (x1 - x0);
  return t < 1 / 3 ? 'prev' : t > 2 / 3 ? 'next' : 'close';
}
function act(z) {
  if (z === 'prev') world.rolling ? world.rollTo(world.rollAt - 1) : world.step(-1);
  else if (z === 'next') world.rolling ? world.rollTo(world.rollAt + 1) : world.step(1);
  else if (z === 'close') world.rolling ? leaveRolls() : world.escape();
}
const cp = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2, over: false, z: null };
function curTo(z) {
  if (z === cp.z) return;
  cp.z = z;
  if (!z) return;
  curP.style.d = `path("${ZONES[z].d}")`; curP.setAttribute('d', ZONES[z].d);
  curL.textContent = ZONES[z].label;
}
el.addEventListener('pointermove', e => { cp.tx = e.clientX; cp.ty = e.clientY; cp.over = true; });
el.addEventListener('pointerleave', () => { cp.over = false; });
const setNdc = e => { ptr.nx = e.clientX / innerWidth * 2 - 1; ptr.ny = -(e.clientY / innerHeight) * 2 + 1; };
const pdist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

el.addEventListener('pointerdown', e => {
  if (world.rolling) unlock();               // a roll opened from a link has had no click yet
  el.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  setNdc(e); ptr.inside = true;
  if (pointers.size === 1) { ptr.down = true; ptr.moved = 0; ptr.lx = e.clientX; ptr.ly = e.clientY; }
  else { ptr.moved = 99; pinchD = pdist(); }
  el.classList.add('drag');
  if (top.classList.contains('open')) setOpen(false);
});
el.addEventListener('pointermove', e => {
  setNdc(e); ptr.inside = true;
  const pt = pointers.get(e.pointerId);
  if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
  if (pointers.size === 2) {
    const d = pdist(), [a, b] = [...pointers.values()];
    if (!world.rolling) world.pinch(d / pinchD, (a.x + b.x) / innerWidth - 1, -((a.y + b.y) / innerHeight - 1));
    pinchD = d; touched();
  } else if (ptr.down) {
    const dx = e.clientX - ptr.lx, dy = e.clientY - ptr.ly;
    ptr.moved += Math.abs(dx) + Math.abs(dy); ptr.lastMove = performance.now();
    if (ptr.moved > 5) { if (world.rolling) world.rollScroll(-dy * 1.6); else world.drag(dx, dy); touched(); }
  }
  ptr.lx = e.clientX; ptr.ly = e.clientY;
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 1) { const [p] = [...pointers.values()]; ptr.lx = p.x; ptr.ly = p.y; return; }
  if (pointers.size) return;
  ptr.down = false; el.classList.remove('drag');
  if (e.type === 'pointerup' && ptr.moved <= 5) {
    const z = zoneAt(e.clientX);
    if (z) act(z);                                       // in a detail view: back, close or on
    else { setNdc(e); world.click(world.pick()); }
  }
  world.up();
  if (e.pointerType !== 'mouse') ptr.inside = false;
}
el.addEventListener('pointerup', endPointer);
el.addEventListener('pointercancel', endPointer);
el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') ptr.inside = false; });
el.addEventListener('wheel', e => {
  e.preventDefault();
  const k = e.deltaMode === 1 ? 16 : 1;
  const [dx, dy] = e.shiftKey && !e.deltaX ? [e.deltaY * k, 0] : [e.deltaX * k, e.deltaY * k];
  if (world.rolling) world.rollScroll(dy || dx);
  else world.wheel(dx, dy, e.ctrlKey || e.metaKey);
  touched();
}, { passive: false });

addEventListener('keydown', e => {
  if (e.target.closest('input')) return;
  const k = e.key, focused = !!world.focused;
  if (world.rolling) {
    unlock();
    if (k === 'Escape') leaveRolls();
    else if (k === 'ArrowDown' || k === 'ArrowRight' || k === ' ') world.rollTo(world.rollAt + 1);
    else if (k === 'ArrowUp' || k === 'ArrowLeft') world.rollTo(world.rollAt - 1);
    else return;
    e.preventDefault(); return;
  }
  if (k === 'Escape') { if (top.classList.contains('open')) setOpen(false); else world.escape(); }
  else if (k === 'ArrowRight') focused ? world.step(1) : world.pan(1, 0);
  else if (k === 'ArrowLeft') focused ? world.step(-1) : world.pan(-1, 0);
  else if (k === 'ArrowDown' && !focused) world.pan(0, -1);
  else if (k === 'ArrowUp' && !focused) world.pan(0, 1);
  else if (k === '+' || k === '=') world.zoom(.8);
  else if (k === '-') world.zoom(1.25);
  else return;
  e.preventDefault();
});

/* ---------- try your own scans ---------- */
const loading = $('#loading');
async function useFiles(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  loading.hidden = false;
  const list = []; let failed = 0;
  for (let i = 0; i < imgs.length; i++) {
    loading.textContent = `Developing ${i + 1} of ${imgs.length}`;
    try { list.push(await fileToPhoto(imgs[i], i)); } catch (e) { failed++; }
  }
  if (list.length) {
    photos.forEach(p => p.tex?.dispose());
    photos = list; tag = 'all'; rollCount = buildRolls();
    renderTags(); world.setList(photos);
  }
  loading.textContent = failed ? `Skipped ${failed} file${failed > 1 ? 's' : ''} it could not read. Try JPG or PNG.` : '';
  if (failed) setTimeout(() => { loading.hidden = true; }, 4000); else loading.hidden = true;
}
$('#file').addEventListener('change', e => useFiles(e.target.files));
const drop = $('#drop');
let dragDepth = 0;
addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; drop.classList.add('on'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('on'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; drop.classList.remove('on'); useFiles(e.dataTransfer.files); });

addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); world.resize(); });
addEventListener('hashchange', () => setTag(decodeURIComponent(location.hash.slice(1)) || 'all'));

/* ---------- loop ---------- */
const clock = new THREE.Clock();
// The caption of the photo under the pointer sits on the photo itself, along its lower edge: when
// it was taken in the left corner, the film and how it was developed in the right.
let lastHit = null, capP;
const cap = $('#cap');
function setCaption(p, m) {
  if (p !== capP) {
    capP = p;
    $('#capD').textContent = p ? formatDate(p.date) : '';
    $('#capS').textContent = p ? [p.stock, p.dev].filter(Boolean).join(', ') : '';
  }
  cap.classList.toggle('on', !!p);
  if (!p) return;
  const r = world.screenRect(m), x0 = Math.max(r.x0, 0), x1 = Math.min(r.x1, innerWidth);
  cap.style.width = Math.max(0, Math.round(x1 - x0 - 24)) + 'px';
  cap.style.transform = `translate3d(${Math.round(x0 + 12)}px, ${Math.round(Math.min(r.y1, innerHeight - 52) - 12)}px, 0) translateY(-100%)`;   // stays clear of the footer
}
function loop() {
  requestAnimationFrame(loop);
  const dt = clamp(clock.getDelta(), 1 / 240, 1 / 20);
  world.update(dt);
  const hit = ptr.inside && !ptr.down && !world.focused ? world.pick() : null;
  if (hit !== lastHit) {
    if (lastHit) lastHit.userData.isHover = false;
    if (hit) hit.userData.isHover = true;
    lastHit = hit;
  }
  el.classList.toggle('point', !!hit);
  // the oversized pointer trails the real one a touch, and only shows over the picture
  const show = fine.matches && cp.over && inDetail() && !(ptr.down && ptr.moved > 5);
  document.body.classList.toggle('detail', inDetail() && fine.matches);
  if (show) curTo(zoneAt(cp.tx));
  cur.classList.toggle('on', show); curW.classList.toggle('on', show);
  const k = 1 - Math.exp(-dt * 22);
  cp.x += (cp.tx - cp.x) * k; cp.y += (cp.ty - cp.y) * k;
  cur.style.transform = curW.style.transform = `translate3d(${cp.x.toFixed(1)}px, ${cp.y.toFixed(1)}px, 0)`;
  setCaption(hit?.userData.p || null, hit);
  renderer.render(world.scene, world.cam);
}

(async () => {
  photos = await loadManifest();
  // trying your own scans only makes sense while the site still runs on placeholders
  document.querySelector('.scans').hidden = photos.length > 0;
  if (!photos.length) {
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
    photos = await developPlaceholders(60, (i, n) => { loading.textContent = `Developing ${i} of ${n}`; });
  }
  loading.hidden = true;
  rollCount = buildRolls();
  const start = decodeURIComponent(location.hash.slice(1));
  if (start && photos.some(p => p.tags.includes(start))) tag = start;
  renderTags();
  world.setList(filtered(), mode(tag));
  setHint();
  loop();
  if (start.startsWith('rolls')) enterRolls(start.slice(6));
})();
