import * as THREE from 'three';
import { developPlaceholders, fileToPhoto } from './placeholders.js';
import { createCanvas } from './canvas.js';
import { unlock, click as tick, soundOn, setSound } from './sound.js';

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
function buildRolls() {
  rollSeq = photos.filter(p => p.roll != null).sort((a, b) => a.roll - b.roll || frameNo(a.frame) - frameNo(b.frame) || (a.version || 1) - (b.version || 1));
  const by = new Map();
  rollSeq.forEach(p => { if (!by.has(p.roll)) by.set(p.roll, []); by.get(p.roll).push(p); });
  by.forEach(list => list.forEach((p, i) => { p.inRoll = i; p.rollLen = list.length; }));
  return by.size;
}
let rollCount = 0;

/* ---------- worlds: tags that open a place of their own ---------- */
const ICON = {
  rolls: '<rect x="1.5" y="3.5" width="6" height="5"/><path d="M3.5 1.5h5v5"/>',
  people: '<circle cx="5" cy="5" r="3.8"/><ellipse cx="5" cy="5" rx="1.7" ry="3.8"/><path d="M1.2 5h7.6"/>',
  water: '<path d="M.8 3.6c1.4-1.2 2.8 1.2 4.2 0s2.8 1.2 4.2 0M.8 6.8c1.4-1.2 2.8 1.2 4.2 0s2.8 1.2 4.2 0"/>',
  crowded: '<circle cx="2.2" cy="2.8" r=".9"/><circle cx="5.1" cy="2.2" r=".9"/><circle cx="7.9" cy="3" r=".9"/><circle cx="3.5" cy="6" r=".9"/><circle cx="6.6" cy="6.3" r=".9"/><circle cx="5" cy="8.8" r=".7"/>',
  interior: '<path d="M6 8.5h2.5v-7h-7v7H4"/>',
};
const WORLD = { people: 'globe', water: 'drift', crowded: 'grain', interior: 'interior' };
const isWorld = t => t in ICON;
const mode = t => WORLD[t] || null;

/* ---------- tags ---------- */
const top = $('#top'), tagsEl = $('#tags'), moreBtn = $('#more'), filterBtn = $('#filterBtn');
function renderTags() {
  const counts = new Map();
  photos.forEach(p => p.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // the active tag always sits right after "all", so it stays visible when the row is collapsed
  const rows = [['all', photos.length], ...(rollCount ? [['rolls', rollCount]] : []), ...sorted.filter(([t]) => t === tag), ...sorted.filter(([t]) => t !== tag)];
  tagsEl.innerHTML = rows.map(([t, c]) => isWorld(t)
    ? `<li><button class="world" data-tag="${t}" aria-pressed="${t === tag}" aria-label="${t} ${c}, opens its own view"><span class="wl">${[...t].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}</span><svg class="wi" viewBox="0 0 10 10" aria-hidden="true">${ICON[t]}</svg><span class="c">${c}</span></button></li>`
    : `<li><button data-tag="${t}" aria-pressed="${t === tag}">${t}<span class="c">${c}</span></button></li>`).join('');
  fitTags();
}
function fitTags() {
  const items = [...tagsEl.children];
  if (!items.length) return;
  const open = top.classList.contains('open');
  const hidden = open ? 0 : items.filter(li => li.offsetTop > items[0].offsetTop).length;
  moreBtn.hidden = !open && !hidden;
  moreBtn.textContent = open ? 'less' : `+ ${hidden} more`;
}
function setOpen(open) {
  top.classList.toggle('open', open);
  filterBtn.setAttribute('aria-expanded', open);
  filterBtn.textContent = open ? 'close' : 'filter';
  fitTags();
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
moreBtn.addEventListener('click', () => setOpen(!top.classList.contains('open')));
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
function onRollFrame(i, p) {
  tick();
  $('#rName').textContent = `Roll ${p.roll}`;
  $('#rCount').textContent = `${String(p.inRoll + 1).padStart(String(p.rollLen).length, '0')} / ${p.rollLen}`;
  $('#rStock').textContent = p.stock;
  $('#rDev').textContent = p.dev ? p.dev[0].toUpperCase() + p.dev.slice(1) : '';
  $('#rDate').textContent = formatDate(p.date);
  $('#rNum').textContent = p.frame;
  try { history.replaceState(null, '', '#rolls/' + encodeURIComponent(p.key)); } catch (e) {}
}
// the first frame of the next roll, or of the previous one
function rollJump(dir) {
  let i = world.rollAt;
  const start = j => { while (j > 0 && rollSeq[j - 1].roll === rollSeq[j].roll) j--; return j; };
  if (dir > 0) { const r0 = rollSeq[i].roll; while (i < rollSeq.length - 1 && rollSeq[i].roll === r0) i++; }
  else { i = start(i); if (i > 0) i = start(i - 1); }
  world.rollTo(i);
}
$('#rPrevF').addEventListener('click', () => world.rollTo(world.rollAt - 1));
$('#rNextF').addEventListener('click', () => world.rollTo(world.rollAt + 1));
$('#rPrev').addEventListener('click', () => rollJump(-1));
$('#rNext').addEventListener('click', () => rollJump(1));
$('#rClose').addEventListener('click', leaveRolls);
const soundBtn = $('#rSound');
soundBtn.setAttribute('aria-pressed', soundOn());
soundBtn.addEventListener('click', () => { setSound(!soundOn()); soundBtn.setAttribute('aria-pressed', soundOn()); });
$('#toRoll').addEventListener('click', () => enterRolls(null, world.focused));

/* ---------- the glass lens that glides along the bar ---------- */
// A pill of glass follows the pointer from button to button, bending what is behind its rim.
// It sits outside the bar's difference blend, so it can carry real colour: world tags get red glass.
const lens = $('#lens');
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
let lensOn = false;
function lensTo(b) {
  if (!b || !fine.matches) return lensOff();
  const r = b.getBoundingClientRect(), w = Math.round(r.width + 22), h = Math.round(r.height + 12);
  if (!lensOn) { lens.style.transition = 'none'; }
  lens.style.width = w + 'px'; lens.style.height = h + 'px';
  lens.style.transform = `translate3d(${Math.round(r.left - 11)}px, ${Math.round(r.top - 6)}px, 0)`;
  lens.classList.toggle('world', b.classList.contains('world'));
  if (chromium) { const m = $('#glassMap'); m.setAttribute('width', w); m.setAttribute('height', h); }
  if (!lensOn) { lens.offsetWidth; lens.style.transition = ''; }
  lens.classList.add('on'); lensOn = true;
}
function lensOff() { lens.classList.remove('on'); lensOn = false; }
top.addEventListener('pointerover', e => lensTo(e.target.closest('.tags button, .more, .theme button')));
top.addEventListener('pointerleave', lensOff);
top.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) lensTo(e.target.closest('.tags button, .more, .theme button')); });
top.addEventListener('focusout', lensOff);
addEventListener('resize', lensOff);

/* ---------- theme ---------- */
const themeBtns = document.querySelectorAll('[data-theme-set]');
function applyTheme(t, save) {
  root.dataset.theme = t;
  themeBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === t));
  world.setBackground(getComputedStyle(root).getPropertyValue('--paper').trim());
  if (save) try { localStorage.setItem('photographi-theme', t); } catch (e) {}
}
themeBtns.forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themeSet, true)));
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
$('#prev').addEventListener('click', () => world.step(-1));
$('#next').addEventListener('click', () => world.step(1));
$('#close').addEventListener('click', () => world.escape());

/* ---------- input ---------- */
const hint = $('#hint'), hintText = hint.textContent;
function setHint() {
  const m = mode(tag);
  if (m === 'globe') {
    const years = filtered().map(p => String(p.date).slice(0, 4)).filter(Boolean).sort();
    hint.textContent = `Drag to turn it. ${years[0]} at the top, ${years.at(-1)} at the bottom. Click a face.`;
  } else if (m === 'drift') hint.textContent = 'It drifts on its own. Drag or scroll to row along. Click a frame.';
  else if (m === 'grain') hint.textContent = 'Move through the crowd, it makes room. Click a face.';
  else if (m === 'interior') hint.textContent = 'Drag to turn around. Scroll to fold the room open into its plan.';
  else { hint.textContent = hintText; return; }
  hint.classList.remove('gone');
}
const touched = () => hint.classList.add('gone');
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
    if (world.rolling) world.rollTo(world.rollAt + 1);   // a tap leafs on
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

addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); world.resize(); fitTags(); });
addEventListener('hashchange', () => setTag(decodeURIComponent(location.hash.slice(1)) || 'all'));

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let lastHit = null, capP;
function setCaption(p) {
  if (p === capP) return; capP = p;
  $('#capF').textContent = p ? `Frame ${p.frame}` : '';
  $('#capS').textContent = p ? p.stock : '';
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
  setCaption(hit?.userData.p || null);
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
