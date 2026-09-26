import * as THREE from 'three';
import { developPlaceholders, fileToPhoto } from './placeholders.js';
import { createCanvas } from './canvas.js';

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

/* ---------- tags ---------- */
const top = $('#top'), tagsEl = $('#tags'), moreBtn = $('#more'), filterBtn = $('#filterBtn');
function renderTags() {
  const counts = new Map();
  photos.forEach(p => p.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // the active tag always sits right after "all", so it stays visible when the row is collapsed
  const rows = [['all', photos.length], ...sorted.filter(([t]) => t === tag), ...sorted.filter(([t]) => t !== tag)];
  tagsEl.innerHTML = rows.map(([t, c]) => `<li><button data-tag="${t}" aria-pressed="${t === tag}">${t}<span class="c">${c}</span></button></li>`).join('');
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
  if (!photos.some(p => p.tags.includes(t))) t = 'all';
  setOpen(false);
  if (t === tag) return;
  tag = t;
  renderTags();
  world.setList(filtered());
  try { history.replaceState(null, '', t === 'all' ? location.pathname : '#' + encodeURIComponent(t)); } catch (e) {}
}
tagsEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTag(b.dataset.tag); });
moreBtn.addEventListener('click', () => setOpen(!top.classList.contains('open')));
filterBtn.addEventListener('click', () => setOpen(!top.classList.contains('open')));

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
}
$('#iTags').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { world.escape(); setTag(b.dataset.tag); } });
$('#prev').addEventListener('click', () => world.step(-1));
$('#next').addEventListener('click', () => world.step(1));
$('#close').addEventListener('click', () => world.escape());

/* ---------- input ---------- */
const hint = $('#hint');
const touched = () => hint.classList.add('gone');
const setNdc = e => { ptr.nx = e.clientX / innerWidth * 2 - 1; ptr.ny = -(e.clientY / innerHeight) * 2 + 1; };
const pdist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

el.addEventListener('pointerdown', e => {
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
    world.pinch(d / pinchD, (a.x + b.x) / innerWidth - 1, -((a.y + b.y) / innerHeight - 1));
    pinchD = d; touched();
  } else if (ptr.down) {
    const dx = e.clientX - ptr.lx, dy = e.clientY - ptr.ly;
    ptr.moved += Math.abs(dx) + Math.abs(dy); ptr.lastMove = performance.now();
    if (ptr.moved > 5) { world.drag(dx, dy); touched(); }
  }
  ptr.lx = e.clientX; ptr.ly = e.clientY;
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 1) { const [p] = [...pointers.values()]; ptr.lx = p.x; ptr.ly = p.y; return; }
  if (pointers.size) return;
  ptr.down = false; el.classList.remove('drag');
  if (e.type === 'pointerup' && ptr.moved <= 5) { setNdc(e); world.click(world.pick()); }
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
  world.wheel(dx, dy, e.ctrlKey || e.metaKey);
  touched();
}, { passive: false });

addEventListener('keydown', e => {
  if (e.target.closest('input')) return;
  const k = e.key, focused = !!world.focused;
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
    photos = list; tag = 'all';
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
  const start = decodeURIComponent(location.hash.slice(1));
  if (start && photos.some(p => p.tags.includes(start))) tag = start;
  renderTags();
  world.setList(filtered());
  loop();
})();
