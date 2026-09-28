// The infinite canvas: masonry columns that wrap in every direction.
// Columns are ~45vw wide at rest. Each column loops on its own period and drifts at a slightly
// different speed, and the whole sheet bends away and splits colour when you move fast.
import * as THREE from 'three';
import { rng } from './placeholders.js';

const VS = /* glsl */`
uniform vec2 uVel; uniform vec3 uCam;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 d = (wp.xy - uCam.xy) / uCam.z;
  float sp = min(length(uVel), 0.08);
  wp.z -= dot(d, d) * sp * uCam.z * 5.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = /* glsl */`
uniform sampler2D map; uniform float uAlpha; uniform float uTex; uniform vec3 uColor; uniform vec2 uVel;
varying vec2 vUv;
void main() {
  vec3 c = uColor;
  if (uTex > 0.001) {
    vec2 sh = clamp(uVel, -0.08, 0.08) * 0.18;
    vec3 t = vec3(texture2D(map, vUv + sh).r, texture2D(map, vUv).g, texture2D(map, vUv - sh).b);
    c = mix(uColor, t, uTex);
  }
  gl_FragColor = vec4(c, uAlpha);
  #include <colorspace_fragment>
}`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const COL = 1, GAP = .03;

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

  const frac = () => innerWidth < 600 ? .7 : innerWidth < 1000 ? .56 : .45;
  const visH = z => 2 * z * TAN;
  const homeZ = () => (COL / frac()) / (2 * TAN * cam.aspect);
  const minZ = () => homeZ() * .3;
  const maxZ = () => Math.max(homeZ() * 1.05, Math.min((TW - COL - GAP) / (2 * TAN * cam.aspect), (minColH - maxItemH) / (2 * TAN), homeZ() * 6));
  const pxToWorld = (px, z) => px * visH(z) / innerHeight;

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

  function ensurePool(n) {
    while (pool.length < n) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, uTex: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uVel, uCam },
        vertexShader: VS, fragmentShader: FS, transparent: true,
      });
      const m = new THREE.Mesh(geo, mat);
      scene.add(m); pool.push(m);
    }
  }

  function apply(items) {
    list = items;
    slots = layout(items);
    ensurePool(slots.length);
    pool.forEach((m, i) => {
      const sl = slots[i];
      m.visible = !!sl;
      if (!sl) return;
      m.userData = { ...sl, i, hover: 0, delay: null };
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
  function zoomBy(f, nx = 0, ny = 0) {
    unfocus();
    const z1 = clamp(s.tz * f, minZ(), maxZ()), dh = visH(s.tz) - visH(z1);
    s.tx += nx * dh / 2 * cam.aspect; s.ty += ny * dh / 2; s.tz = z1;
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  return {
    scene, cam,
    get focused() { return s.focus?.userData.p || null; },
    setList(items) { if (first) apply(items); else s.pending = items; },
    setBackground(c) { scene.background.set(c); },
    resize() {
      cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
      if (s.focus) focusMesh(s.focus); else s.tz = clamp(s.tz, minZ(), maxZ());
    },
    pick() {
      ndc.set(ptr.nx, ptr.ny); ray.setFromCamera(ndc, cam);
      const cands = s.focus ? [s.focus] : pool.filter(m => m.visible && m.material.uniforms.uAlpha.value > .5);
      return ray.intersectObjects(cands, false)[0]?.object || null;
    },
    drag(dx, dy) {
      unfocus();
      const wpp = pxToWorld(1, s.z);
      s.tx -= dx * wpp; s.ty += dy * wpp; s.vx = -dx * wpp * .9; s.vy = dy * wpp * .9;
    },
    up() { if (performance.now() - ptr.lastMove > 90) s.vx = s.vy = 0; },
    wheel(dx, dy, zoom) {
      if (zoom) return zoomBy(Math.exp(dy * .01), ptr.nx, ptr.ny);
      unfocus();
      const wpp = pxToWorld(1, s.z);
      s.tx += dx * wpp; s.ty -= dy * wpp;
    },
    pinch(ratio, cx, cy) { zoomBy(1 / ratio, cx, cy); },
    zoom(f) { zoomBy(f); },
    pan(cx, cy) { unfocus(); s.tx += cx * (COL + GAP); s.ty += cy * (COL * .5); },
    click(hit) { if (s.focus) return unfocus(); focusMesh(hit); },
    step(dir) {
      if (!s.focus) return;
      const n = list.length, j = ((s.focus.userData.i % n) + dir + n) % n;
      focusMesh(pool[j]);
    },
    escape: unfocus,
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
        if (faded) { apply(s.pending); s.pending = null; }
        return;
      }
      if (!ptr.down && !s.focus) { s.tx += s.vx; s.ty += s.vy; const f = Math.pow(.9, dt * 60); s.vx *= f; s.vy *= f; }
      if (!s.focus) s.tz = clamp(s.tz, minZ(), maxZ());
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

      for (const m of pool) {
        if (!m.visible) continue;
        const u = m.userData, col = cols[u.c], U = m.material.uniforms;
        let x = u.bx - s.x; x = ((x % TW) + TW) % TW; if (x > TW / 2) x -= TW;
        let y = u.by - s.y - col.acc; y = ((y % col.P) + col.P) % col.P; if (y > col.P / 2) y -= col.P;
        m.position.set(s.x + x, s.y + y, 0);
        if (u.delay === null) u.delay = reduced ? 0 : Math.min(Math.hypot(x / vw, y / vh) * .5, 1.1);
        const intro = reduced ? 1 : clamp((s.t - u.delay) / .5, 0, 1);
        U.uAlpha.value = damp(U.uAlpha.value, (s.focus ? (m === s.focus ? 1 : 0) : 1) * intro, 8, dt);
        if (Math.abs(x) < vw * 1.3 && Math.abs(y) < vh * 1.3) { u.p.lastNear = s.t; u.p.evicted = false; request(u.p); }
        if (U.map.value !== u.p.tex) U.map.value = u.p.tex || null;
        U.uTex.value = damp(U.uTex.value, u.p.ready ? 1 : 0, 6, dt);
        u.hover = damp(u.hover, u.isHover && !s.focus ? 1 : 0, 10, dt);
        const sc = 1 + u.hover * .015;
        m.scale.set(u.w * sc, u.h * sc, 1);
      }
      if (s.frame % 60 === 0) {
        for (const p of list) if (p.src && p.tex && !p.evicted && s.t - (p.lastNear ?? 0) > 6) { p.tex.dispose(); p.evicted = true; }
      }
    },
  };
}
