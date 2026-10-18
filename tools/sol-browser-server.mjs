// Isolate SOL's browser checks from other agents rebuilding the shared ui/dist.
import { createServer, request } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve('data/sol-ui');
const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.wav':'audio/wav', '.webm':'video/webm' };
createServer((req, res) => {
  if (/^\/(api|public)\//.test(req.url)) {
    const upstream = request({ hostname:'127.0.0.1', port:8802, path:req.url, method:req.method, headers:req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
  }
  let path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (path !== root && !path.startsWith(root + '/')) {
    // Windows paths use backslashes.
    if (!path.startsWith(root + '\\')) { res.writeHead(403); res.end(); return; }
  }
  if (!existsSync(path) || !statSync(path).isFile()) path = resolve(root, 'index.html');
  const body = readFileSync(path);
  const headers = { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Accept-Ranges':'bytes' };
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]); const end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range':`bytes */${body.length}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Length':end-start+1, 'Content-Range':`bytes ${start}-${end}/${body.length}` }); res.end(body.subarray(start,end+1)); return;
  }
  res.writeHead(200, { ...headers, 'Content-Length':body.length }); res.end(body);
}).listen(8803, '127.0.0.1');
