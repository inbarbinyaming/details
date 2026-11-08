const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filepath = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!filepath.startsWith(root + path.sep) && filepath !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const bytes = await fs.readFile(filepath);
    res.writeHead(200, { 'Content-Type': types[path.extname(filepath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(bytes);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('File unavailable');
  }
}).listen(port, () => console.log(`details. at http://localhost:${port}`));
