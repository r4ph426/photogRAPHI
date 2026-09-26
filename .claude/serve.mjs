// Tiny static server for the site (python's http.server can't read ~/Documents here).
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT) || 5391;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  // tools/versions.html saves which edit versions to keep; Claude applies it to photos.json
  if (req.method === 'POST' && req.url === '/api/versions') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      await writeFile(join(root, 'photos/versions.json'), JSON.stringify({ savedAt: new Date().toISOString(), ...data }, null, 2) + '\n');
      res.writeHead(200).end('ok');
    } catch (e) { res.writeHead(400).end('bad json'); }
    return;
  }
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
