// Local preview server for Cold Horizon. Run: node serve.js  →  http://localhost:8766
// Serves this folder on localhost only; "/" opens index.html (Act 0).
const fs = require('fs'), path = require('path'), root = __dirname, PORT = 8766;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
require('http').createServer((req, res) => {
  let f = decodeURIComponent(req.url.split('?')[0]);
  if (f === '/') f = '/index.html';
  const fp = path.join(root, path.normalize(f));
  if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(fp)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(fp));
}).listen(PORT, '127.0.0.1', () => console.log('Cold Horizon at http://localhost:' + PORT + '  (Ctrl-C to stop)'));
