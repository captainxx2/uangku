/**
 * Server statis kecil untuk pratinjau lokal (tanpa dependensi).
 * Jalankan: node serve.js  ->  http://localhost:8080
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const TIPE = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let berkas = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!berkas.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(berkas, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 — tidak ditemukan'); return; }
    res.writeHead(200, { 'Content-Type': TIPE[path.extname(berkas).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('UANGKU siap di http://localhost:' + PORT);
});
