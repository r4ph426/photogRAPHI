#!/usr/bin/env node
// Turns scans in photos/originals/ into web images and photos/photos.json.
//   node scripts/ingest.mjs
// Uses macOS `sips`, so there is nothing to install. Safe to re-run: unchanged scans are skipped,
// and hand-edited stock, frame, date, tags and "hidden": true in photos.json are kept.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('../photos/', import.meta.url).pathname;
const dir = { originals: join(root, 'originals'), web: join(root, 'web'), full: join(root, 'full') };
const manifestPath = join(root, 'photos.json');
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';
const EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.webp']);
const SIZE = { web: 1200, full: 2048 }; // canvas tiles, and the frame view on retina screens
const QUALITY = { web: '72', full: '78' };

const STOCKS = ['Portra 160', 'Portra 400', 'Portra 800', 'Ektar 100', 'Gold 200', 'Ultramax 400', 'ColorPlus 200', 'Pro Image 100', 'CineStill 800T', 'CineStill 400D', 'CineStill 50D', 'Superia 400', 'Superia X-TRA 400', 'Fujicolor 200', 'Pro 400H', 'C200', 'HP5 Plus', 'Tri-X 400', 'Delta 3200', 'Delta 400', 'Delta 100', 'FP4 Plus', 'Pan F Plus', 'XP2', 'T-Max 400', 'T-Max 100', 'Kentmere 400', 'Kentmere 100', 'Fomapan 400', 'Fomapan 100', 'Ektachrome E100', 'Velvia 50', 'Provia 100F', 'Lomo 400', 'Lomo 800'];
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const sips = (...args) => execFileSync('sips', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function dims(file) {
  const out = sips('-g', 'pixelWidth', '-g', 'pixelHeight', file);
  return { w: +out.match(/pixelWidth: (\d+)/)[1], h: +out.match(/pixelHeight: (\d+)/)[1] };
}
function toJpeg(src, dest, size, q, d) {
  const resize = Math.max(d.w, d.h) > size ? ['-Z', String(size)] : [];
  const profile = existsSync(SRGB) ? ['--matchTo', SRGB] : [];
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', q, ...resize, ...profile, src, '--out', dest);
}
// average colour for the loading placeholder, and a saturation check for black and white film
function analyse(file) {
  const tmp = join(tmpdir(), `photographi-${process.pid}.bmp`);
  sips('-s', 'format', 'bmp', '-z', '12', '12', file, '--out', tmp);
  const b = readFileSync(tmp); rmSync(tmp, { force: true });
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = Math.abs(b.readInt32LE(22)), bpp = b.readUInt16LE(28) / 8;
  const row = Math.ceil(w * bpp / 4) * 4;
  let r = 0, g = 0, bl = 0, sat = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = off + y * row + x * bpp, B = b[i], G = b[i + 1], R = b[i + 2];
    r += R; g += G; bl += B;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat += mx ? (mx - mn) / mx : 0;
  }
  const n = w * h, hex = [r, g, bl].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  return { color: '#' + hex, bw: sat / n < .08 };
}
// Raphi's scans: "Film17_2016_MAR_HP5at800-scan0024_Processed-2.jpg"
//   -> roll 17, March 2016, HP5 Plus pushed to 800, frame 24, edit version 2
// Anything else falls back to finding a known stock and a trailing frame number in the name.
const FILMS = [
  ['trixstanddev', 'Tri-X 400', 'stand developed'], ['trix', 'Tri-X 400'], ['tmax400', 'T-Max 400'], ['hp5', 'HP5 Plus 400'],
  ['delta3200', 'Delta 3200'], ['delta400', 'Delta 400'], ['delta100', 'Delta 100'], ['acros100', 'Acros 100'],
  ['rpx400', 'RPX 400'], ['apx400', 'APX 400'], ['fp4', 'FP4 Plus 125'], ['portra160', 'Portra 160'], ['portra400', 'Portra 400'],
  ['portra800', 'Portra 800'], ['ektar100', 'Ektar 100'], ['agfavista400', 'Agfa Vista 400'], ['agfavista200', 'Agfa Vista 200'],
  ['s200', 'S200'], ['disposablecam', 'Disposable camera'],
];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function film(token) {
  const t = norm(token), hit = FILMS.find(([k]) => t.startsWith(k));
  if (!hit) return { stock: token, dev: '' };
  const dev = [];
  const push = t.match(/at(\d{3,4})/);
  if (push) dev.push(`pushed to ${push[1]}`);
  if (hit[2] || t.includes('standdev')) dev.push('stand developed');
  return { stock: hit[1], dev: dev.join(', ') };
}
function fromName(name) {
  const stem = basename(name, extname(name));
  const m = stem.match(/^Film(\d+)_(\d{4})[_-]([A-Z]{3})_([^-]+)-scan(\d+)(?:[-_ ]bearbeitet)?[-_ ]?processed(?:[-_ ]?\(?(\d)\)?)?$/i);
  if (m) {
    const mo = MONTHS.indexOf(m[3].toUpperCase()) + 1;
    return {
      roll: +m[1], date: mo ? `${m[2]}-${String(mo).padStart(2, '0')}` : m[2], ...film(m[4]),
      frame: String(parseInt(m[5], 10)), key: `${m[1]}-${m[2]}-${m[4]}-${parseInt(m[5], 10)}`.toLowerCase(), version: m[6] ? +m[6] : 1,
    };
  }
  const clean = stem.replace(/[-_ ]*processed.*$/i, ''), key = norm(clean);
  let stock = STOCKS.find(s => key.includes(norm(s))) || '';
  if (!stock) {
    const first = STOCKS.filter(s => key.includes(norm(s.split(' ')[0])));
    const family = new Set(first.map(s => s.split(' ')[0]));
    stock = family.size === 1 ? (first.length === 1 ? first[0] : [...family][0]) : '';
  }
  // the last standalone number that can be a frame (0 to 40, optional A); film names and years don't qualify.
  // Only when a film was recognised, otherwise "Bundeshaus 2" would become frame 2.
  const frames = clean.split(/[^a-z0-9]+/i).filter(t => /^\d{1,4}a?$/i.test(t) && parseInt(t, 10) <= 40);
  const f = stock && frames.at(-1);
  return { stock, dev: '', frame: f ? `${parseInt(f, 10)}${/a$/i.test(f) ? 'A' : ''}` : '', key, version: 1 };
}
const slug = name => basename(name, extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (process.argv.includes('--names')) {
  const names = readdirSync(dir.originals).filter(f => EXT.has(extname(f).toLowerCase()));
  for (const f of names) { const g = fromName(f); console.log([f, g.stock, g.dev, g.frame, g.date ?? '', g.roll ?? '', `v${g.version}`].join(' | ')); }
  process.exit(0);
}
mkdirSync(dir.web, { recursive: true }); mkdirSync(dir.full, { recursive: true });
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8') || '[]') : [];
const byFile = new Map(old.map(p => [p.file, p]));
const all = readdirSync(dir.originals).filter(f => EXT.has(extname(f).toLowerCase()) && !f.startsWith('.'));
// empty files are still being copied in; they get picked up on the next run
const copying = all.filter(f => statSync(join(dir.originals, f)).size === 0);
const files = all.filter(f => !copying.includes(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const out = [], used = new Set(); let made = 0, failed = 0;
for (const [i, file] of files.entries()) {
  // "scan0035_Processed" and "scan0035-processed" slug the same; give the second its own file
  let s = slug(file);
  while (used.has(s)) s += '-dup';
  used.add(s);
  const src = join(dir.originals, file);
  const web = join(dir.web, `${s}.jpg`), full = join(dir.full, `${s}.jpg`);
  const prev = byFile.get(file);
  try {
    const fresh = existsSync(web) && existsSync(full) && statSync(web).mtimeMs > statSync(src).mtimeMs;
    if (!fresh) {
      const d = dims(src);
      toJpeg(src, full, SIZE.full, QUALITY.full, d);
      toJpeg(src, web, SIZE.web, QUALITY.web, d);
      made++;
    }
    const { w, h } = dims(web), { color, bw } = analyse(web), guess = fromName(file);
    // most of the archive is black and white film, so the minority gets the automatic tag
    const tags = (prev?.tags || []).filter(t => t !== 'colour');
    if (!bw) tags.push('colour');
    out.push({
      file, src: `photos/web/${s}.jpg`, full: `photos/full/${s}.jpg`, w, h,
      stock: prev?.stock ?? guess.stock, dev: prev?.dev ?? guess.dev, frame: prev?.frame ?? guess.frame,
      date: prev?.date ?? guess.date ?? '', roll: guess.roll ?? null, key: guess.key, version: guess.version,
      tags, color,
      ...(prev?.hidden ? { hidden: true } : {}),
      ...(prev && !prev.needsTags ? {} : { needsTags: true }),
    });
    process.stdout.write(`\r${i + 1} of ${files.length}  ${file}`.padEnd(80));
  } catch (e) {
    failed++;
    console.error(`\ncould not process ${file}: ${e.stderr?.toString().trim() || e.message}`);
  }
}
writeFileSync(manifestPath, JSON.stringify(out, null, 2) + '\n');
const gone = old.filter(p => !files.includes(p.file)).length;
console.log(`\n${out.length} photos in photos.json, ${made} newly processed${failed ? `, ${failed} failed` : ''}${gone ? `, ${gone} removed` : ''}.`);
console.log(`${out.filter(p => p.needsTags).length} still need tags.`);
if (copying.length) console.log(`${copying.length} files are still empty (copying?) and were skipped.`);
