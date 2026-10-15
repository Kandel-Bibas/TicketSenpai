// Static file server for the demo front end. Separate from the backend on purpose:
// the page talks to the API cross-origin, the way a real front end would.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const host = process.env.WEB_HOST ?? '127.0.0.1';
const port = Number(process.env.WEB_PORT ?? 4011);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`WEB_PORT must be an integer from 0 to 65535, got "${process.env.WEB_PORT}"`);

const server = createServer(async (req, res) => {
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', 'Method not allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://web.invalid').pathname);
  } catch {
    return send(400, 'text/plain; charset=utf-8', 'Malformed path');
  }
  const file = normalize(join(ROOT, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  const type = TYPES[extname(file)];
  // Only the front end's own asset types, and only from inside this directory.
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || type === undefined || file === fileURLToPath(import.meta.url)) {
    return send(404, 'text/plain; charset=utf-8', 'Not found');
  }
  try {
    send(200, type, await readFile(file));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return send(404, 'text/plain; charset=utf-8', 'Not found');
    console.error(`Could not read ${file}: ${err.message}`);
    send(500, 'text/plain; charset=utf-8', 'Could not read the file');
  }
});

server.listen(port, host, () => {
  console.log(`Demo front end on http://${host}:${server.address().port} (expects the backend on http://127.0.0.1:4010; override with ?api=)`);
});
