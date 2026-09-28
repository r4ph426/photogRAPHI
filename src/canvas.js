// The infinite canvas: masonry columns that wrap in every direction.
// Columns are ~45vw wide at rest. Each column loops on its own period and drifts at a slightly
// different speed, and the whole sheet bends away and splits colour when you move fast.
// A second formation, the roll: the photos on screen gather into a pile and become a stack of
// prints you leaf through in shooting order. The same meshes fly between the two.
// Then the worlds: a tag that is a place of its own. Its photos fly out of the sheet into a shape
// with its own physics. people: a turning globe, oldest at the top pole. water: a curved ribbon
// that drifts and ripples like a surface. crowded: a packed crowd of grainy prints that make room
// for the pointer. interior: a room you stand in, which unfolds into its floor plan as you scroll.
import * as THREE from 'three';
import { rng } from './placeholders.js';

const VS = /* glsl */`
uniform vec2 uVel; uniform vec3 uCam; uniform float uTime; uniform float uWave;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 d = (wp.xy - uCam.xy) / uCam.z;
  float sp = min(length(uVel), 0.08);
  wp.z -= dot(d, d) * sp * uCam.z * 5.0;
  // water: the print itself swells like a surface
  wp.y += sin(wp.x * 2.2 + uTime * 1.3) * 0.022 * uWave;
  wp.z += sin(wp.x * 1.4 - uTime * 0.9 + wp.y * 2.0) * 0.035 * uWave;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = /* glsl */`
uniform sampler2D map; uniform float uAlpha; uniform float uTex; uniform vec3 uColor; uniform vec2 uVel;
uniform float uTime; uniform float uWave; uniform float uGrain;
varying vec2 vUv;
void main() {
  vec3 c = uColor;
  vec2 uv = vUv;
  // water: seen through a moving surface
  uv.x += sin(uv.y * 18.0 + uTime * 2.2) * 0.004 * uWave;
  uv.y += sin(uv.x * 14.0 - uTime * 1.7) * 0.004 * uWave;
  if (uTex > 0.001) {
    vec2 sh = clamp(uVel, -0.08, 0.08) * 0.18;
    vec3 t = vec3(texture2D(map, uv + sh).r, texture2D(map, uv).g, texture2D(map, uv - sh).b);
    c = mix(uColor, t, uTex);
  }
  // crowded: pushed film grain, alive at 24 frames a second
  if (uGrain > 0.001) {
    float n = fract(sin(dot(floor(gl_FragCoord.xy / 1.6) + floor(uTime * 24.0) * 7.13, vec2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * 0.2 * uGrain;
  }
  gl_FragColor = vec4(c, uAlpha);
  #include <colorspace_fragment>
}`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const COL = 1, GAP = .03;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const inOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const STACK = 10;                                // prints in the deck at once

export function createCanvas({ ptr, reduced, frameRect, onFocus, onUnfocus }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#F4F3EF');
  const FOV = 35, TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const cam = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, .01, 200);
  const uVel = { value: new THREE.Vector2() }, uCam = { value: new THREE.Vector3() };
  const geo = new THREE.PlaneGeometry(1, 1, 24, 24);
  const pool = [];
  let list = [], slots = [], cols = [], TW = 1, minColH = 1, maxItemH = 1, first = true;
  const s = { x: 0, y: 0, z: 2, tx: 0, ty: 0, tz: 2, vx: 0, vy: 0, px: 0, py: 0, t: 0, frame: 0, focus: null, backZ: 2, pending: null };

  // the roll: seq is every photo in shooting order, c is where you are in it (float while moving)
  const deck = [];
  const r = { on: false, k: 0, seq: [], c: 0, ct: 0, idle: 0, last: -1, onFrame: null, hold: null };

  // the worlds: W.k is the formation clock, W.f the lift of one chosen photo out of the shape
  const W = {
    kind: null, on: false, was: false, k: 0, focus: null, f: 0, t: 0, cx: 0, cy: 0, cz: 0,
    rx: .35, ry: 0, vx: 0, vy: .1, R: 1, zoom: 1,             // globe: tilt, turn, spin
    off: 0, ov: 0, L: 1, hb: .9,                              // drift: where the ribbon is, its speed
    gR: .5,                                                   // crowded: how far people step aside
    yaw: 0, yv: 0, un: 0, ut: 0, D: 1.2, H: .72,              // interior: turn, unfold, room size
  };
  const uTime = { value: 0 };
  const V = new THREE.Vector3(), N = new THREE.Vector3(), E = new THREE.Euler(), Q0 = new THREE.Quaternion(), QT = new THREE.Quaternion(), QB = new THREE.Quaternion(), QG = new THREE.Quaternion();
  const LOOK = new THREE.Object3D(), P3 = new THREE.Vector3(), P2 = new THREE.Vector3();
  const ZAX = new THREE.Vector3(0, 0, 1);
  const narrow = () => clamp(cam.aspect || 1, .3, 1);
  // where the camera sits in each world
  function worldZ() {
    if (W.kind === 'globe') return W.R * 1.3 / (TAN * narrow()) / W.zoom;
    if (W.kind === 'drift') return W.hb / (.9 * TAN * Math.min(1, narrow() * 1.6));
    return W.cz;
  }
  // how far in front of the camera a chosen photo hangs when it lifts out of the shape
  function liftD() {
    if (W.kind === 'globe') return Math.max(.5, s.z - W.R * 1.3);
    if (W.kind === 'interior') return .8;
    return s.z * .6;
  }

  const frac = () => innerWidth < 600 ? .7 : innerWidth < 1000 ? .56 : .45;
  const visH = z => 2 * z * TAN;
  const homeZ = () => (COL / frac()) / (2 * TAN * cam.aspect);
  const minZ = () => homeZ() * .3;
  const maxZ = () => Math.max(homeZ() * 1.05, Math.min((TW - COL - GAP) / (2 * TAN * cam.aspect), (minColH - maxItemH) / (2 * TAN), homeZ() * 6));
  const pxToWorld = (px, z) => px * visH(z) / innerHeight;

  // Every print shares one long side, like paper from the same box; it sits flush left in the
  // window the frame leaves open, the same place a focused photo goes.
  function deckBox() {
    const f = frameRect(), w = f.x1 - f.x0, h = f.y1 - f.y0;
    return { x0: f.x0, cy: (f.y0 + f.y1) / 2, L: Math.min(h * .74, w * .78) };
  }
  const toWorld = (px, py) => [s.x + pxToWorld(px - innerWidth / 2, s.z), s.y - pxToWorld(py - innerHeight / 2, s.z)];

  function layout(items) {
    const n = items.length;
    const C = clamp(Math.round(Math.sqrt(n) * .9), 4, 14);
    const total = Math.max(n, C * 4);
    const R = rng(n * 31 + 7);
    const offs = Array.from({ length: C }, (_, c) => c === 0 ? 0 : R() * .45);
    const heights = offs.slice();
    const out = [];
    for (let i = 0; i < total; i++) {
      const p = items[i % n];
      let c = 0;
      for (let k = 1; k < C; k++) if (heights[k] < heights[c]) c = k;
      // every photo fills its column, so the gutters are the same everywhere
      const w = COL, h = w / p.aspect;
      out.push({ p, c, w, h, bx: c * (COL + GAP) + w / 2, by: -heights[c] - h / 2 });
      heights[c] += h + GAP;
    }
    cols = heights.map((hh, c) => ({ P: hh - offs[c], f: reduced ? 1 : 1 + ((c % 3) - 1) * .07, acc: 0 }));
    TW = C * (COL + GAP);
    minColH = Math.min(...cols.map(c => c.P));
    maxItemH = Math.max(...out.map(o => o.h));
    return out;
  }

  function mesh() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uTex: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uVel, uCam, uTime, uWave: { value: 0 }, uGrain: { value: 0 } },
      vertexShader: VS, fragmentShader: FS, transparent: true,
    });
    const m = new THREE.Mesh(geo, mat);
    scene.add(m);
    return m;
  }
  function ensurePool(n) {
    while (pool.length < n) pool.push(mesh());
  }

  function apply(items, mode) {
    list = items;
    slots = layout(items);
    W.kind = mode || null; W.on = !!mode; W.focus = null; W.f = 0; W.was = false;
    if (!W.on) W.k = 0;
    ensurePool(slots.length);
    pool.forEach((m, i) => {
      const sl = slots[i];
      m.visible = !!sl;
      if (!sl) return;
      m.userData = { ...sl, i, hover: 0, delay: null, jr: (rng(i * 13 + 5)() - .5) * .14 };
      const u = m.material.uniforms;
      u.map.value = sl.p.tex || null; u.uTex.value = sl.p.ready ? 1 : 0;
      u.uColor.value.set(sl.p.color || '#808080'); u.uAlpha.value = 0;
      m.scale.set(sl.w, sl.h, 1);
    });
    if (s.focus) { s.focus = null; onUnfocus(); }
    const z = homeZ();
    s.tz = s.backZ = z;
    s.z = first && !reduced ? Math.min(maxZ(), z * 2.4) : z;
    // Entering the site opens on a different photo every time; a filter starts from its first photo.
    // The chosen photo sits where the first one would: its column on the left margin, its top under the bar.
    const at = first ? slots[entryIndex(items)] : { c: 0, by: 0, h: 0 };
    const vw = visH(z) * cam.aspect;
    s.x = s.tx = s.px = at.c * (COL + GAP) + vw / 2 - pxToWorld(innerWidth < 600 ? 16 : 40, z);
    s.y = s.ty = s.py = at.by + at.h / 2 + pxToWorld(innerWidth < 600 ? 72 : 88, z) - visH(z) / 2;
    s.vx = s.vy = 0; s.t = 0; first = false;
    if (W.on) shape(items);
  }
  // Lay the tag's photos out in the world's shape. Photos past the first n repeat ones that fill
  // the sheet; in a world they just leave.
  function shape(items) {
    const n = items.length, byDate = items.map((p, i) => i).sort((a, b) => String(items[a].date).localeCompare(String(items[b].date)) || a - b);
    const fit = (u, side) => { const a = u.p.aspect; u.ww = a >= 1 ? side : side * a; u.wh = a >= 1 ? side / a : side; };
    W.cx = s.x; W.cy = s.y; W.cz = s.tz; W.k = reduced ? 1 : 0; W.t = 0;
    for (let i = n; i < slots.length; i++) pool[i].userData.wt = false;
    const R = rng(n * 17 + 3);

    if (W.kind === 'globe') {
      // Fibonacci points walked in date order from the top pole down: latitude is time
      const GA = Math.PI * (3 - Math.sqrt(5)), side = Math.sqrt(4 * Math.PI / n) * .86;
      W.R = 1; W.rx = .35; W.ry = 0; W.vy = .1; W.zoom = 1;
      byDate.forEach((i, k) => {
        const y = 1 - 2 * (k + .5) / n, rr = Math.sqrt(1 - y * y), th = k * GA, u = pool[i].userData;
        u.wt = true; u.gp = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
        u.wd = (k / n) * .35;                     // the top forms first, then the years below
        fit(u, side);
      });
    }

    if (W.kind === 'drift') {
      // one ribbon in date order, all prints the same height, like a strip of film on water
      W.hb = .9; W.off = 0; W.ov = .12;
      let x = 0;
      byDate.forEach(i => {
        const u = pool[i].userData, w = W.hb * u.p.aspect;
        u.wt = true; u.ww = w; u.wh = W.hb; u.dx = x + w / 2; x += w + .1;
      });
      W.L = x;
      // start in the middle of the river; the stagger runs outward from the centre
      W.off = W.L / 2;
      byDate.forEach(i => { const u = pool[i].userData; let d = u.dx - W.off; d = ((d % W.L) + W.L) % W.L; if (d > W.L / 2) d -= W.L; u.wd = Math.min(Math.abs(d) * .08, .35); });
    }

    if (W.kind === 'grain') {
      // a crowd packed shoulder to shoulder across the whole view, slightly overlapping
      const z = s.tz, vh = visH(z) * .86, vw = visH(z) * cam.aspect * .98;
      const cols = Math.max(3, Math.round(Math.sqrt(n * vw / vh))), rows = Math.ceil(n / cols);
      const cw = vw / cols, ch = vh / rows, side = Math.min(cw, ch) * 1.3;
      W.gR = Math.max(cw, ch) * 1.7;
      const order = items.map((p, i) => i).sort(() => R() - .5);
      order.forEach((i, k) => {
        const u = pool[i].userData, c = k % cols, r0 = Math.floor(k / cols);
        u.wt = true; fit(u, side);
        u.gx = W.cx - vw / 2 + (c + .5 + (r0 % 2 ? .25 : -.25) + (R() - .5) * .35) * cw;
        u.gy = W.cy + vh / 2 - vh * .02 - (r0 + .5 + (R() - .5) * .3) * ch;
        u.gz = R() * .02; u.gr = (R() - .5) * .16; u.ph = R() * 6.3;
        u.ox = u.oy = u.ovx = u.ovy = 0;
        u.wd = R() * .35;
      });
    }

    if (W.kind === 'interior') {
      // four walls around the camera, the photos hung in rows along them, in date order
      W.D = 1.2; W.H = .72; W.yaw = 0; W.yv = .04; W.un = W.ut = 0;
      const rows = 3, per = Math.ceil(n / 4), cols = Math.ceil(per / rows);
      const cw = 2 * W.D / cols, ch = W.H / rows, side = Math.min(cw, ch) * .84;
      byDate.forEach((i, k) => {
        const u = pool[i].userData, j = Math.floor(k / per), q = k % per;
        u.wt = true; fit(u, side);
        u.rj = j; u.ra = -W.D + (q % cols + .5) * cw; u.rb = W.H - (Math.floor(q / cols) + .5) * ch;
        u.wd = (j / 4) * .3 + (q / per) * .05;
      });
    }
    s.tx = W.cx; s.ty = W.cy; s.tz = worldZ();
  }

  // The resting place of one photo in the world, before it lifts. Fills o and the QT quaternion.
  const o = { x: 0, y: 0, z: 0, w: 0, h: 0, a: 1, near: true, hov: .03 };
  function place(m, u, dt, vw, vh) {
    o.w = u.ww; o.h = u.wh; o.a = 1; o.near = true; o.hov = .03;
    if (W.kind === 'globe') {
      V.copy(u.gp).applyEuler(E.set(W.rx, W.ry, 0, 'XYZ'));
      o.x = W.cx + V.x * W.R; o.y = W.cy + V.y * W.R; o.z = V.z * W.R;
      LOOK.position.set(o.x, o.y, o.z); LOOK.lookAt(o.x + V.x, o.y + V.y, o.z + V.z); QT.copy(LOOK.quaternion);
      // the front is bright and sharp, the far side a faint memory
      o.a = V.z > 0 ? .45 + .55 * smoothstep(0, .6, V.z) : .1 * (1 + V.z);
      o.near = V.z > -.2; o.hov = .12;
    } else if (W.kind === 'drift') {
      let xs = u.dx - W.off; xs = ((xs % W.L) + W.L) % W.L; if (xs > W.L / 2) xs -= W.L;
      const c = .05, sw = Math.sin(xs * .9 + W.t * .7);
      o.x = W.cx + xs; o.y = W.cy + sw * .035; o.z = -c * xs * xs;
      QT.setFromEuler(E.set(0, Math.atan(2 * c * xs), sw * .02));
      const fe = Math.max(vw * .42, W.hb * 1.4);          // a phone still shows the neighbours coming
      o.a = 1 - smoothstep(fe, fe + Math.max(vw * .2, W.hb * .6), Math.abs(xs));
      o.near = Math.abs(xs) < vw * .9;
    } else if (W.kind === 'grain') {
      // step aside for the pointer on a spring, and breathe a little while standing
      let tx = 0, ty = 0, push = 0;
      if (ptr.inside && !W.focus) {
        const px = s.x + ptr.nx * vw / 2, py = s.y + ptr.ny * vh / 2;
        const dx = u.gx - px, dy = u.gy - py, d = Math.hypot(dx, dy) || 1e-4;
        push = d < W.gR ? Math.pow(1 - d / W.gR, 2) : 0;
        tx = dx / d * push * W.gR * .9; ty = dy / d * push * W.gR * .9;
      }
      const h = Math.min(dt, 1 / 30);
      u.ovx += ((tx - u.ox) * 90 - u.ovx * 11) * h; u.ovy += ((ty - u.oy) * 90 - u.ovy * 11) * h;
      u.ox += u.ovx * h; u.oy += u.ovy * h;
      const br = reduced ? 0 : .006;
      o.x = u.gx + u.ox + Math.sin(W.t * .8 + u.ph) * br; o.y = u.gy + u.oy + Math.cos(W.t * .7 + u.ph) * br; o.z = u.gz;
      const sq = 1 - Math.min(.3, Math.hypot(u.ox, u.oy) / W.gR * .4);
      o.w *= sq; o.h *= sq; o.hov = 0;
      QT.setFromAxisAngle(ZAX, u.gr);
    } else if (W.kind === 'interior') {
      const th = W.yaw + u.rj * Math.PI / 2, sn = Math.sin(th), cs = Math.cos(th);
      // on the wall, facing you
      P3.set(W.cx + sn * W.D + cs * u.ra, W.cy + u.rb - W.H / 2, W.cz - cs * W.D + sn * u.ra);
      LOOK.position.copy(P3); LOOK.lookAt(W.cx, P3.y, W.cz); QT.copy(LOOK.quaternion);
      // laid flat in the plan: every wall folded out around the floor
      const PD = (W.D + W.H) * 1.35 / (TAN * narrow());
      P2.set(W.cx + sn * (W.D + u.rb) + cs * u.ra, W.cy + cs * (W.D + u.rb) - sn * u.ra, W.cz - PD);
      QB.setFromAxisAngle(ZAX, -th);
      const e = inOut(W.un);
      o.x = P3.x + (P2.x - P3.x) * e; o.y = P3.y + (P2.y - P3.y) * e; o.z = P3.z + (P2.z - P3.z) * e;
      QT.slerp(QB, e); o.hov = .04;
    }
  }
  function entryIndex(items) {
    const key = p => p.src || p.name || '';
    let last = null;
    try { last = localStorage.getItem('photographi-entry'); } catch (e) {}
    const pick = () => Math.floor(Math.random() * items.length);
    let i = pick();
    for (let k = 0; k < 8 && items.length > 1 && key(items[i]) === last; k++) i = pick();
    try { localStorage.setItem('photographi-entry', key(items[i])); } catch (e) {}
    return i;
  }

  // lazy textures for real photos: load when near the view, free GPU memory when long gone
  function request(p) {
    if (!p.src || p.loading || p.tex) return;
    p.loading = true;
    const img = new Image(); img.decoding = 'async'; img.src = p.src;
    img.decode().then(() => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      p.tex = t; p.ready = true;
    }).catch(() => { p.failed = true; });
  }
  function requestFull(p) {
    if (!p.full || p.fullLoading) return;
    p.fullLoading = true;
    const img = new Image(); img.decoding = 'async'; img.src = p.full;
    img.decode().then(() => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      p.tex?.dispose(); p.tex = t; p.ready = true;
    }).catch(() => {});
  }

  function focusMesh(m) {
    if (!m) return;
    if (!s.focus) s.backZ = s.tz;
    s.focus = m; s.vx = s.vy = 0;
    const u = m.userData, r = frameRect(), rw = r.x1 - r.x0, rh = r.y1 - r.y0;
    const pxH = Math.min(rh, rw * u.h / u.w), pxW = pxH * u.w / u.h;
    const z = u.h * innerHeight / (pxH * 2 * TAN);
    s.tz = z;
    // flush left in the window the frame leaves open
    s.tx = m.position.x - pxToWorld(r.x0 + pxW / 2 - innerWidth / 2, z);
    s.ty = m.position.y + pxToWorld((r.y0 + r.y1) / 2 - innerHeight / 2, z);
    requestFull(u.p);
    onFocus(u.p, u.i % list.length, list.length);
  }
  function unfocus() {
    if (!s.focus) return;
    s.focus = null; s.tz = s.backZ; onUnfocus();
  }
  function worldFocus(m) {
    if (!m || !m.userData.wt) return;
    W.focus = m; W.vx = W.vy = W.ov = W.yv = 0;
    requestFull(m.userData.p);
    onFocus(m.userData.p, m.userData.i % list.length, list.length);
  }
  function worldUnfocus() { if (!W.focus) return; W.focus = null; onUnfocus(); }
  function zoomBy(f, nx = 0, ny = 0) {
    unfocus();
    const z1 = clamp(s.tz * f, minZ(), maxZ()), dh = visH(s.tz) - visH(z1);
    s.tx += nx * dh / 2 * cam.aspect; s.ty += ny * dh / 2; s.tz = z1;
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  return {
    scene, cam,
    get focused() { return (s.focus || W.focus)?.userData.p || null; },
    get inWorld() { return W.on; },
    setList(items, mode) { if (first) apply(items, mode); else s.pending = { items, mode }; },
    setBackground(c) { scene.background.set(c); },
    resize() {
      if (!innerWidth || !innerHeight) return;   // a hidden pane reports 0 and would send the camera to infinity
      cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
      if (W.on) s.tz = worldZ();
      else if (s.focus) focusMesh(s.focus); else s.tz = clamp(s.tz, minZ(), maxZ());
    },
    pick() {
      if (r.on || r.k > 0) return null;
      ndc.set(ptr.nx, ptr.ny); ray.setFromCamera(ndc, cam);
      const cands = s.focus ? [s.focus] : pool.filter(m => m.visible && m.material.uniforms.uAlpha.value > .5);
      return ray.intersectObjects(cands, false)[0]?.object || null;
    },
    drag(dx, dy) {
      if (W.on) {
        if (W.kind === 'grain') return;          // the crowd answers the pointer itself
        worldUnfocus();
        if (W.kind === 'globe') { W.vy = dx * .005; W.vx = dy * .005; W.ry += dx * .005; W.rx = clamp(W.rx + dy * .005, -1.3, 1.3); }
        if (W.kind === 'drift') { const d = -pxToWorld(dx, s.z); W.off += d; W.ov = d * 60; }
        if (W.kind === 'interior') { const d = dx * .004 * (W.un > .5 ? -1 : 1); W.yaw += d; W.yv = d * 60; }
        return;
      }
      unfocus();
      const wpp = pxToWorld(1, s.z);
      s.tx -= dx * wpp; s.ty += dy * wpp; s.vx = -dx * wpp * .9; s.vy = dy * wpp * .9;
    },
    up() { if (W.on) return; if (performance.now() - ptr.lastMove > 90) s.vx = s.vy = 0; },
    wheel(dx, dy, zoom) {
      if (W.on) {
        if (W.kind === 'globe') {
          if (zoom) { W.zoom = clamp(W.zoom * Math.exp(-dy * .01), .7, 2.6); s.tz = worldZ(); return; }
          worldUnfocus(); W.ry += dx * .003; W.rx = clamp(W.rx + dy * .003, -1.3, 1.3); W.vy = dx * .003; W.vx = 0;
        }
        if (W.kind === 'drift') { worldUnfocus(); const d = pxToWorld(dy || dx, s.z) * .6; W.off += d; W.ov = d * 30; }
        if (W.kind === 'interior') { worldUnfocus(); W.ut = clamp(W.ut + dy * .0016, 0, 1); if (dx) W.yaw += dx * .003; }
        return;
      }
      if (zoom) return zoomBy(Math.exp(dy * .01), ptr.nx, ptr.ny);
      unfocus();
      const wpp = pxToWorld(1, s.z);
      s.tx += dx * wpp; s.ty -= dy * wpp;
    },
    pinch(ratio, cx, cy) {
      if (W.on) { if (W.kind === 'globe') { W.zoom = clamp(W.zoom * ratio, .7, 2.6); s.tz = worldZ(); } if (W.kind === 'interior') W.ut = clamp(W.ut + (1 - ratio) * 2, 0, 1); return; }
      zoomBy(1 / ratio, cx, cy);
    },
    zoom(f) {
      if (W.on) { if (W.kind === 'globe') { W.zoom = clamp(W.zoom / f, .7, 2.6); s.tz = worldZ(); } if (W.kind === 'interior') W.ut = f > 1 ? 1 : 0; return; }
      zoomBy(f);
    },
    pan(cx, cy) {
      if (W.on) {
        if (W.kind === 'globe') { W.ry += cx * .35; W.rx = clamp(W.rx - cy * .25, -1.3, 1.3); }
        if (W.kind === 'drift') W.ov += cx * 1.5;
        if (W.kind === 'interior') { if (cx) W.yaw += cx * Math.PI / 4; if (cy) W.ut = cy < 0 ? 1 : 0; }
        return;
      }
      unfocus(); s.tx += cx * (COL + GAP); s.ty += cy * (COL * .5); },
    click(hit) {
      if (W.on) { if (W.focus) return worldUnfocus(); if (hit) worldFocus(hit); return; }
      if (s.focus) return unfocus(); focusMesh(hit);
    },
    step(dir) {
      if (W.on) {
        if (!W.focus) return;
        const n = list.length; worldFocus(pool[((W.focus.userData.i % n) + dir + n) % n]); return;
      }
      if (!s.focus) return;
      const n = list.length, j = ((s.focus.userData.i % n) + dir + n) % n;
      focusMesh(pool[j]);
    },
    escape() { if (W.on) worldUnfocus(); else unfocus(); },
    get rolling() { return r.on; },
    enterRoll(seq, i, onFrame) {
      // From an open photo the camera stays put: that photo already hangs where the deck's front
      // print goes, so the roll grows around it. The zoom back out waits until you leave.
      // The other photos were already faded out around it and stay out until you leave.
      if (W.on) { W.was = true; W.on = false; r.hold = W.focus; W.focus = null; if (r.hold) onUnfocus(); s.backZ = homeZ(); }
      else if (s.focus) { r.hold = s.focus; s.focus = null; onUnfocus(); s.tz = s.z; } else s.backZ = s.tz;
      while (deck.length < STACK) { const m = mesh(); m.renderOrder = 1; m.visible = false; deck.push(m); }
      r.seq = seq; r.onFrame = onFrame; r.on = true;
      r.c = r.ct = clamp(i, 0, seq.length - 1); r.last = -1; r.idle = 0;
      s.vx = s.vy = 0; s.tx = s.x; s.ty = s.y;
      if (reduced) r.k = 1;
    },
    leaveRoll() {
      r.on = false; r.hold = null;
      if (W.was) { W.was = false; W.on = true; W.f = 0; s.tz = worldZ(); } else s.tz = clamp(s.backZ, minZ(), maxZ());
      if (reduced) r.k = 0;
    },
    rollScroll(px) { r.ct = clamp(r.ct + px / 260, 0, r.seq.length - 1); r.idle = 0; },
    rollTo(i) { r.ct = clamp(Math.round(i), 0, r.seq.length - 1); r.idle = 1; },
    get rollAt() { return Math.round(r.ct); },
    update(dt) {
      s.t += dt; s.frame++;
      if (s.pending) {
        let faded = true;
        for (const m of pool) {
          if (!m.visible) continue;
          const u = m.material.uniforms;
          u.uAlpha.value = damp(u.uAlpha.value, 0, 16, dt);
          if (u.uAlpha.value > .02) faded = false;
        }
        if (faded) { apply(s.pending.items, s.pending.mode); s.pending = null; }
        return;
      }
      // one clock for the formation change, about a second each way
      r.k = clamp(r.k + (r.on ? dt : -dt) / 1.1, 0, 1);
      const rolling = r.on || r.k > 0;
      W.k = clamp(W.k + (W.on ? dt : -dt) / 1.6, 0, 1);
      W.f = damp(W.f, W.focus ? 1 : 0, 5, dt);
      uTime.value = s.t;
      const inW = W.k > 0 && !!W.kind;
      if (inW) {
        W.t += dt;
        const free = !ptr.down && !W.focus, mv = reduced ? 0 : 1;
        if (W.kind === 'globe' && free) {
          // it keeps turning on its own; a drag hands it a spin that settles back to the drift
          W.ry += W.vy * dt * mv; W.vy = damp(W.vy, .1, 1.2, dt); W.vx = damp(W.vx, 0, 3, dt);
          W.rx = clamp(W.rx + W.vx * dt * 60 * .2, -1.3, 1.3);
        }
        if (W.kind === 'drift' && free) { W.off += W.ov * dt * mv; W.ov = damp(W.ov, .12, .8, dt); }
        if (W.kind === 'interior') {
          if (free) { W.yaw += W.yv * dt * mv; W.yv = damp(W.yv, W.un > .5 ? 0 : .04, 1, dt); }
          W.un = reduced ? W.ut : damp(W.un, W.ut, 4, dt);
        }
      }
      if (!ptr.down && !s.focus && !rolling && W.k === 0) { s.tx += s.vx; s.ty += s.vy; const f = Math.pow(.9, dt * 60); s.vx *= f; s.vy *= f; }
      if (!s.focus && !W.on) s.tz = clamp(s.tz, minZ(), maxZ());
      const l = s.focus ? 4.5 : 9;
      const py = s.y;
      s.x = damp(s.x, s.tx, l, dt); s.y = damp(s.y, s.ty, l, dt); s.z = damp(s.z, s.tz, s.focus ? 4.5 : 5, dt);
      if (!s.focus) { const dy = s.y - py; for (const c of cols) c.acc += (c.f - 1) * dy; }

      const vh = visH(s.z), vw = vh * cam.aspect, n60 = 1 / (dt * 60);
      const vx = (s.x - s.px) / vh * n60, vy = (s.y - s.py) / vh * n60;
      s.px = s.x; s.py = s.y;
      uVel.value.set(reduced ? 0 : damp(uVel.value.x, vx, 12, dt), reduced ? 0 : damp(uVel.value.y, vy, 12, dt));
      uCam.value.set(s.x, s.y, s.z);
      cam.position.set(s.x, s.y, s.z);

      // where the pile gathers: the front print's place, a little behind it
      const box = rolling ? deckBox() : null;
      const Lw = box ? pxToWorld(box.L, s.z) : 0;
      const [pileX, pileY] = box ? toWorld(box.x0 + box.L / 2, box.cy) : [0, 0];
      const depth = Lw * .16;

      for (const m of pool) {
        if (!m.visible) continue;
        const u = m.userData, col = cols[u.c], U = m.material.uniforms;
        let x = u.bx - s.x; x = ((x % TW) + TW) % TW; if (x > TW / 2) x -= TW;
        let y = u.by - s.y - col.acc; y = ((y % col.P) + col.P) % col.P; if (y > col.P / 2) y -= col.P;
        let px = s.x + x, py = s.y + y, pz = 0, sc = 1, rz = 0, keep = 1;
        if (r.k > 0) {
          // on screen: fly into the pile, nearest first; off screen: just go
          const near = Math.abs(x) < vw * .8 && Math.abs(y) < vh * .8;
          const d = near ? Math.min(Math.hypot(x / vw, y / vh) * .3, .3) : 0;
          const k = clamp((r.k - d) / (1 - .3), 0, 1), e = inOut(k);
          if (near) {
            px += (pileX - px) * e; py += (pileY - py) * e; pz = -depth * 2 * e;
            sc = 1 + (Lw / Math.max(u.w, u.h) - 1) * e; rz = u.jr * e;
            keep = 1 - smoothstep(.6, .95, k);
          } else keep = 1 - smoothstep(0, .3, r.k);
        }
        let sx = u.w * sc, sy = u.h * sc, inShape = 0;
        Q0.setFromEuler(E.set(0, 0, rz)); m.quaternion.copy(Q0);
        U.uWave.value = 0; U.uGrain.value = 0;
        if (inW && u.wt) {
          const e = inOut(clamp((W.k - u.wd) / .65, 0, 1));
          place(m, u, dt, vw, vh);
          let gx = o.x, gy = o.y, gz = o.z, gw = o.w, gh = o.h, ga = o.a;
          if (m === W.focus && W.f > .001) {
            // the chosen photo lifts out of the shape and hangs flat where an open photo goes
            const f = inOut(W.f), d = liftD(), zf = s.z - d, wpp = 2 * d * TAN / innerHeight;
            const fr = frameRect(), rw = fr.x1 - fr.x0, rh = fr.y1 - fr.y0;
            const pxH = Math.min(rh, rw / u.p.aspect), pxW = pxH * u.p.aspect;
            const fx = s.x + (fr.x0 + pxW / 2 - innerWidth / 2) * wpp, fy = s.y - ((fr.y0 + fr.y1) / 2 - innerHeight / 2) * wpp;
            gx += (fx - gx) * f; gy += (fy - gy) * f; gz += (zf - gz) * f;
            gw += (pxW * wpp - gw) * f; gh += (pxH * wpp - gh) * f;
            QT.slerp(QG.identity(), f); ga += (1 - ga) * f;
            m.renderOrder = 2;
          } else { m.renderOrder = 0; if (W.focus) ga *= 1 - .85 * W.f; }
          px += (gx - px) * e; py += (gy - py) * e; pz += (gz - pz) * e;
          sx += (gw - sx) * e; sy += (gh - sy) * e;
          m.quaternion.slerpQuaternions(Q0, QT, e);
          keep *= 1 + (ga - 1) * e; inShape = e;
          const still = m === W.focus ? 1 - W.f : 1;
          if (W.kind === 'drift') U.uWave.value = e * still * (reduced ? 0 : 1);
          if (W.kind === 'grain') U.uGrain.value = e * still;
          if (o.near || m === W.focus) { u.p.lastNear = s.t; u.p.evicted = false; request(u.p); }
        } else if (inW) keep *= 1 - smoothstep(0, .3, W.k);
        m.position.set(px, py, pz);
        if (u.delay === null) u.delay = reduced ? 0 : Math.min(Math.hypot(x / vw, y / vh) * .5, 1.1);
        const intro = reduced ? 1 : clamp((s.t - u.delay) / .5, 0, 1);
        const lit = s.focus ? m === s.focus : r.hold ? m === r.hold : true;
        U.uAlpha.value = damp(U.uAlpha.value, (lit ? 1 : 0) * intro * keep, r.k > 0 || W.k > 0 ? 30 : 8, dt);
        if (r.k < 1 && W.k === 0 && Math.abs(x) < vw * 1.3 && Math.abs(y) < vh * 1.3) { u.p.lastNear = s.t; u.p.evicted = false; request(u.p); }
        if (U.map.value !== u.p.tex) U.map.value = u.p.tex || null;
        U.uTex.value = damp(U.uTex.value, u.p.ready ? 1 : 0, 6, dt);
        u.hover = damp(u.hover, u.isHover && !s.focus && !W.focus && !rolling ? 1 : 0, 10, dt);
        const hs = 1 + u.hover * (inShape ? o.hov * inShape : .015);
        m.scale.set(sx * hs, sy * hs, 1);
      }

      // the deck: prints behind rise and fade into the paper; the one you leave comes toward you
      if (rolling) {
        r.idle += dt;
        if (r.idle > .16) r.ct = Math.round(r.ct);            // come to rest on a print
        r.c = reduced ? r.ct : damp(r.c, r.ct, 7, dt);
        const at = Math.round(r.c);
        if (at !== r.last) { r.last = at; r.onFrame?.(at, r.seq[at]); }
        const base = Math.floor(r.c), used = new Set();
        for (let j = base - 1; j < base + STACK - 1; j++) {
          if (j < 0 || j >= r.seq.length) continue;
          const m = deck[j % STACK], p = r.seq[j], U = m.material.uniforms;
          used.add(m);
          if (m.userData.p !== p) {
            m.userData = { p, jr: (rng(j * 7 + 3)() - .5) * .07 };
            U.uColor.value.set(p.color || '#808080'); U.uTex.value = p.ready ? 1 : 0; U.uAlpha.value = 0;
          }
          const d = j - r.c;
          const wpx = p.aspect >= 1 ? box.L : box.L * p.aspect, hpx = p.aspect >= 1 ? box.L / p.aspect : box.L;
          let [X, Y] = toWorld(box.x0 + wpx / 2, box.cy), Z = 0, rx = 0, rz = 0, a = 1;
          if (d >= 0) {
            X += pxToWorld(d * 8, s.z); Y += pxToWorld(d * 18, s.z); Z = -d * depth;
            rz = m.userData.jr * Math.min(d, 1);
            a = clamp(1 - d * .15, 0, 1) * clamp(STACK - 2 - d, 0, 1);
          } else {
            const e = -d;                                    // 0 to 1 as it leaves
            if (!reduced) { Z = e * s.z * .5; Y += pxToWorld(e * 40, s.z); rx = -e * .2; }
            a = 1 - smoothstep(0, .85, e);
          }
          const show = smoothstep(0, 1, (r.k - .45 - Math.max(d, 0) * .04) / .45);
          m.visible = true;
          m.position.set(X, Y, Z); m.rotation.set(rx, 0, rz);
          m.scale.set(pxToWorld(wpx, s.z), pxToWorld(hpx, s.z), 1);
          U.uAlpha.value = a * show;
          p.lastNear = s.t; p.evicted = false; request(p);
          if (Math.abs(d) < .5 && r.k === 1) requestFull(p);
          if (U.map.value !== p.tex) U.map.value = p.tex || null;
          U.uTex.value = damp(U.uTex.value, p.ready ? 1 : 0, 6, dt);
        }
        for (const m of deck) if (!used.has(m)) m.visible = false;
      } else for (const m of deck) m.visible = false;
      if (s.frame % 60 === 0) {
        for (const p of list) if (p.src && p.tex && !p.evicted && s.t - (p.lastNear ?? 0) > 6) { p.tex.dispose(); p.evicted = true; }
      }
    },
  };
}
