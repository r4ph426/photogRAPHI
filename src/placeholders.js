// Generated stand-in "film scans" until the real photos are in photos/photos.json.
// Each one gets tags from what it depicts, so the tag filter can be tried end to end.
import * as THREE from 'three';

export function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const parse = c => c[0] === '#' ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : c.match(/[\d.]+/g).slice(0, 3).map(Number);
const mix = (a, b, t) => { const A = parse(a), B = parse(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const rgba = (c, a) => `rgba(${parse(c).join(',')},${a})`;
const hex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function lin(x, x0, y0, x1, y1, stops) { const g = x.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }

const STOCKS = [
  { name: 'Portra 400',     sat: .82, con: .9,  lift: .07, tint: [1.05, 1.0, .92], grain: 16 },
  { name: 'HP5 Plus 400',   bw: true, con: 1.08, lift: .05, grain: 30 },
  { name: 'Ektar 100',      sat: 1.3, con: 1.12, lift: .01, tint: [1.03, 1.0, .97], grain: 8 },
  { name: 'CineStill 800T', sat: .95, con: 1.04, lift: .04, tint: [.9, .98, 1.12], grain: 22 },
  { name: 'Tri-X 400',      bw: true, con: 1.35, lift: 0, grain: 26 },
  { name: 'Gold 200',       sat: 1.05, con: 1.0, lift: .05, tint: [1.08, 1.02, .84], grain: 16 },
  { name: 'Superia 400',    sat: .95, con: 1.0, lift: .06, tint: [.96, 1.04, .97], grain: 18 },
];
const SCENES = [
  { sky: ['#e9b88a', '#f6dfc0'], ground: '#5e4a36', dark: '#2b2119', sun: '#fff1d6', tag: 'golden hour' },
  { sky: ['#34425f', '#9aa6bd'], ground: '#1e2330', dark: '#0f1219', sun: '#ffe2b0', tag: 'blue hour' },
  { sky: ['#bfc3c4', '#e2e2dd'], ground: '#6f716a', dark: '#3a3b37', sun: '#ffffff', tag: 'overcast' },
  { sky: ['#4f86c0', '#cfe0ec'], ground: '#b5a88f', dark: '#4a4336', sun: '#fffbe8' },
  { sky: ['#d98f6a', '#f0c9a4'], ground: '#3d3a45', dark: '#1f1c24', sun: '#ffe6c4', tag: 'golden hour' },
  { sky: ['#9fb7a8', '#dfe6dc'], ground: '#465a3f', dark: '#1f2a1c', sun: '#ffffff', tag: 'overcast' },
];
function sun(x, cx, cy, r, col) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r * 5);
  g.addColorStop(0, col); g.addColorStop(.2, col); g.addColorStop(.22, rgba(col, .35)); g.addColorStop(1, rgba(col, 0));
  x.fillStyle = g; x.fillRect(cx - r * 5, cy - r * 5, r * 10, r * 10);
}
const COMPS = {
  horizon: { tags: ['landscape'], draw(x, w, h, P, R) {
    const hy = h * (.5 + R() * .22);
    x.fillStyle = lin(x, 0, 0, 0, hy, [[0, P.sky[0]], [1, P.sky[1]]]); x.fillRect(0, 0, w, hy + 1);
    if (R() < .6) sun(x, w * (.15 + R() * .7), hy - h * (.04 + R() * .2), h * (.02 + R() * .03), P.sun);
    x.fillStyle = lin(x, 0, hy, 0, h, [[0, P.ground], [1, P.dark]]); x.fillRect(0, hy, w, h - hy);
    x.fillStyle = P.dark;
    if (R() < .5) {
      let bx = -10;
      while (bx < w) { const bw = w * (.03 + R() * .09), bh = h * (.02 + R() * .2); if (R() < .75) x.fillRect(bx, hy - bh, bw, bh + 2); bx += bw; }
    } else {
      const n = 2 + (R() * 5 | 0);
      for (let i = 0; i < n; i++) {
        const tx = R() * w, tr = h * (.04 + R() * .12);
        x.beginPath(); x.ellipse(tx, hy - tr * .95, tr * .62, tr, 0, 0, Math.PI * 2); x.fill();
        x.fillRect(tx - 1.5, hy - tr * .2, 3, tr * .25);
      }
    }
  } },
  sea: { tags: ['sea'], draw(x, w, h, P, R) {
    const hy = h * (.38 + R() * .25);
    x.fillStyle = lin(x, 0, 0, 0, hy, [[0, P.sky[0]], [1, P.sky[1]]]); x.fillRect(0, 0, w, hy + 1);
    const sx = w * (.2 + R() * .6);
    if (R() < .7) sun(x, sx, hy - h * (.02 + R() * .12), h * .025, P.sun);
    x.fillStyle = lin(x, 0, hy, 0, h, [[0, mix(P.sky[1], P.dark, .25)], [1, mix(P.sky[0], P.dark, .55)]]); x.fillRect(0, hy, w, h - hy);
    for (let i = 0; i < 260; i++) {
      const f = Math.pow(R(), 1.8), yy = hy + f * (h - hy), len = w * (.01 + R() * .06) * (1 + f * 2);
      x.fillStyle = `rgba(255,250,235,${R() * .45})`; x.fillRect(sx + (R() - .5) * w * (.2 + f * .8) - len / 2, yy, len, 1 + f * 2);
    }
    if (R() < .5) { x.fillStyle = P.dark; x.beginPath(); x.arc(w * (.2 + R() * .6), hy + (h - hy) * (.2 + R() * .5), h * .018, 0, 7); x.fill(); }
  } },
  window: { tags: ['interior'], draw(x, w, h, P, R) {
    x.fillStyle = lin(x, 0, 0, w, h, [[0, mix(P.dark, '#000000', .2)], [1, P.dark]]); x.fillRect(0, 0, w, h);
    const ww = w * (.22 + R() * .2), wh = h * (.38 + R() * .3), wx = w * (.12 + R() * (.76 - ww / w)), wy = h * (.08 + R() * .15);
    x.fillStyle = lin(x, 0, wy, 0, wy + wh, [[0, P.sky[0]], [1, P.sky[1]]]); x.fillRect(wx, wy, ww, wh);
    x.save(); x.globalAlpha = .28; x.fillStyle = P.sun; x.beginPath();
    const off = w * (.15 + R() * .2), fy = wy + wh + h * .08;
    x.moveTo(wx + off, fy); x.lineTo(wx + ww + off * 1.6, fy); x.lineTo(wx + ww + off * 2.6, h); x.lineTo(wx + off * 1.8, h); x.closePath(); x.fill(); x.restore();
    x.fillStyle = P.dark; const mw = Math.max(3, w * .008);
    x.fillRect(wx + ww / 2 - mw / 2, wy, mw, wh); x.fillRect(wx, wy + wh * .45, ww, mw);
    x.fillStyle = mix(P.dark, P.sun, .25); x.fillRect(wx - w * .02, wy + wh, ww + w * .04, h * .015);
  } },
  blinds: { tags: ['shadows'], draw(x, w, h, P, R) {
    x.fillStyle = lin(x, 0, 0, w, h, [[0, mix(P.sky[1], P.sun, .3)], [1, mix(P.sky[1], P.ground, .35)]]); x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2); x.rotate(-.35 - R() * .4);
    const band = h * (.035 + R() * .03);
    x.fillStyle = 'rgba(20,15,10,.32)';
    for (let y = -h * 1.2; y < h * 1.2; y += band * 2.1) x.fillRect(-w * 1.2, y, w * 2.4, band);
    x.restore();
    if (R() < .7) {
      x.fillStyle = 'rgba(20,15,10,.38)';
      const bx = w * (.2 + R() * .6), by = h * (.55 + R() * .3);
      for (let i = 0; i < 9; i++) { x.save(); x.translate(bx, by); x.rotate(-1.3 + R() * 2.6); x.beginPath(); x.ellipse(0, -h * .18, w * .018, h * .16, 0, 0, 7); x.fill(); x.restore(); }
    }
  } },
  facade: { tags: ['architecture'], draw(x, w, h, P, R) {
    const skyH = h * (.08 + R() * .18);
    x.fillStyle = lin(x, 0, 0, 0, skyH, [[0, P.sky[0]], [1, P.sky[1]]]); x.fillRect(0, 0, w, skyH);
    const base = mix(P.ground, P.sun, .45 + R() * .3);
    x.fillStyle = base; x.fillRect(0, skyH, w, h - skyH);
    const cols = 4 + (R() * 5 | 0), rows = 5 + (R() * 6 | 0), cw = w / cols, rh = (h - skyH) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const wx = c * cw + cw * .22, wy = skyH + r * rh + rh * .2;
      x.fillStyle = R() < .25 ? mix(P.sky[0], P.sky[1], R()) : mix(P.dark, base, .15 + R() * .2);
      x.fillRect(wx, wy, cw * .56, rh * .58);
      x.fillStyle = mix(P.dark, base, .55); x.fillRect(c * cw + cw * .14, wy + rh * .6, cw * .72, rh * .05);
    }
    x.fillStyle = lin(x, 0, 0, w, 0, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.25)']]); x.fillRect(0, skyH, w, h);
  } },
  still: { tags: ['still life'], draw(x, w, h, P, R) {
    const ty = h * (.58 + R() * .12);
    x.fillStyle = lin(x, 0, 0, 0, ty, [[0, mix(P.sky[1], P.dark, .35)], [1, mix(P.sky[1], '#ffffff', .2)]]); x.fillRect(0, 0, w, ty);
    x.fillStyle = lin(x, 0, ty, 0, h, [[0, mix(P.ground, '#ffffff', .3)], [1, P.ground]]); x.fillRect(0, ty, w, h - ty);
    const FR = ['#8f2f22', '#c4862a', '#5f6e28', '#394418', '#d8bf6e', '#a0522d', '#2f3b52'];
    const n = 1 + (R() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const r = Math.min(w, h) * (.07 + R() * .09), fx = w * (.2 + R() * .6), fy = ty - r * .7 + R() * h * .12;
      x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.ellipse(fx + r * .3, fy + r * .85, r * 1.05, r * .28, 0, 0, 7); x.fill();
      const col = FR[R() * FR.length | 0], g = x.createRadialGradient(fx - r * .35, fy - r * .4, r * .05, fx, fy, r);
      g.addColorStop(0, mix(col, '#ffffff', .55)); g.addColorStop(.35, col); g.addColorStop(1, mix(col, '#000000', .6));
      x.fillStyle = g; x.beginPath(); x.arc(fx, fy, r, 0, 7); x.fill();
    }
  } },
  road: { tags: ['road', 'landscape'], draw(x, w, h, P, R) {
    const hy = h * (.4 + R() * .15), vx = w * (.35 + R() * .3);
    x.fillStyle = lin(x, 0, 0, 0, hy, [[0, P.sky[0]], [1, P.sky[1]]]); x.fillRect(0, 0, w, hy + 1);
    x.fillStyle = lin(x, 0, hy, 0, h, [[0, P.ground], [1, P.dark]]); x.fillRect(0, hy, w, h - hy);
    x.fillStyle = mix(P.dark, P.ground, .3); x.beginPath();
    x.moveTo(vx - w * .01, hy); x.lineTo(vx + w * .01, hy); x.lineTo(w * 1.15, h); x.lineTo(-w * .15, h); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,250,230,.75)';
    for (let t = .05; t < 1; t += .09) {
      const t2 = t + .035, y1 = hy + (h - hy) * t * t, y2 = hy + (h - hy) * t2 * t2, lw = 1 + t * w * .012;
      x.fillRect(vx + (w / 2 - vx) * ((y1 - hy) / (h - hy)) - lw / 2, y1, lw, y2 - y1);
    }
    x.fillStyle = P.dark;
    for (let k = 0; k < 6; k++) {
      const t = Math.pow(k / 6 + .1, 1.6), py = hy + (h - hy) * t, ph = h * .5 * t + 2;
      x.fillRect(vx + (w * 1.05 - vx) * t, py - ph, 1 + t * 4, ph);
    }
  } },
};
const COMP_KEYS = Object.keys(COMPS);

// Film look: stock colour response, lifted blacks, vignette, grain. Returns the average colour.
function grade(x, w, h, S, R) {
  const im = x.getImageData(0, 0, w, h), d = im.data;
  const cx = w / 2, cy = h / 2, md = cx * cx + cy * cy, t = S.tint || [1, 1, 1], sat = S.sat ?? 1;
  const sum = [0, 0, 0]; let count = 0;
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) * (y - cy);
    for (let xx = 0; xx < w; xx++) {
      const i = (y * w + xx) << 2;
      let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const l = .299 * r + .587 * g + .114 * b;
      if (S.bw) { r = g = b = l; } else { r = (l + (r - l) * sat) * t[0]; g = (l + (g - l) * sat) * t[1]; b = (l + (b - l) * sat) * t[2]; }
      r = S.lift + ((r - .5) * S.con + .5) * (1 - S.lift);
      g = S.lift + ((g - .5) * S.con + .5) * (1 - S.lift);
      b = S.lift + ((b - .5) * S.con + .5) * (1 - S.lift);
      const v = 1 - .42 * ((xx - cx) * (xx - cx) + dy) / md, n = (R() - .5) * S.grain / 255;
      d[i] = (r * v + n) * 255; d[i + 1] = (g * v + n) * 255; d[i + 2] = (b * v + n) * 255;
      if ((xx & 15) === 0 && (y & 15) === 0) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; count++; }
    }
  }
  x.putImageData(im, 0, 0);
  return hex(sum.map(v => v / count));
}
function leak(x, w, h, R) {
  x.save(); x.globalCompositeOperation = 'screen';
  const lx = R() < .5 ? 0 : w, ly = h * R(), g = x.createRadialGradient(lx, ly, 0, lx, ly, w * .6);
  g.addColorStop(0, 'rgba(255,110,40,.75)'); g.addColorStop(.4, 'rgba(255,60,30,.3)'); g.addColorStop(1, 'rgba(255,60,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h); x.restore();
}
function texture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export async function developPlaceholders(n, onProgress) {
  const R = rng(20260925), list = [];
  let start = 1;
  for (let i = 0; i < n; i++) {
    const roll = Math.floor(i / 6);
    if (i % 6 === 0) start = 1 + Math.floor(R() * 28);
    const S = STOCKS[roll % STOCKS.length], P = SCENES[R() * SCENES.length | 0], comp = COMPS[COMP_KEYS[R() * COMP_KEYS.length | 0]];
    const portrait = R() < .32, w = portrait ? 560 : 840, h = portrait ? 840 : 560;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    comp.draw(x, w, h, P, R);
    const b = document.createElement('canvas'); b.width = w; b.height = h;
    const bx = b.getContext('2d'); bx.filter = 'blur(1.1px)'; bx.drawImage(c, 0, 0); x.drawImage(b, 0, 0);
    const color = grade(x, w, h, S, R);
    if (!S.bw && R() < .2) leak(x, w, h, R);
    const tags = [...comp.tags];
    if (S.bw) tags.push('black and white'); else if (P.tag) tags.push(P.tag);
    list.push({ tex: texture(c), ready: true, aspect: w / h, stock: S.name, frame: `${start + i % 6}${R() < .5 ? 'A' : ''}`, tags, color });
    if (i % 4 === 3) { onProgress?.(i + 1, n); await new Promise(requestAnimationFrame); }
  }
  return list;
}

/* your own scans, dropped in for a local test */
const STOCK_NAMES = ['Portra 160', 'Portra 400', 'Portra 800', 'Ektar 100', 'Gold 200', 'Ultramax 400', 'ColorPlus 200', 'CineStill 800T', 'CineStill 400D', 'CineStill 50D', 'Superia 400', 'Pro 400H', 'HP5 Plus', 'Tri-X 400', 'Delta 3200', 'Delta 100', 'FP4 Plus', 'XP2', 'T-Max 400', 'Kentmere 400', 'Ektachrome E100', 'Velvia 50'];
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function stockFromName(name) {
  const key = norm(name);
  const full = STOCK_NAMES.find(s => key.includes(norm(s)));
  if (full) return full;
  const part = STOCK_NAMES.find(s => key.includes(norm(s.split(' ')[0])));
  return part ? part.split(' ')[0] : 'Stock unknown';
}
export async function fileToPhoto(file, i) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const px = document.createElement('canvas').getContext('2d'); px.canvas.width = px.canvas.height = 1;
  px.drawImage(c, 0, 0, 1, 1);
  const m = file.name.match(/(\d{1,2}a?)(?=\.[a-z0-9]+$)/i);
  return { tex: texture(c), ready: true, aspect: c.width / c.height, stock: stockFromName(file.name), frame: m ? m[1].toUpperCase() : String(i + 1), tags: ['your scans'], color: hex([...px.getImageData(0, 0, 1, 1).data].slice(0, 3)) };
}
