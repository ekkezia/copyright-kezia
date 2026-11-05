// Flicker matrix web server.
//
//   GET  /             website (public/index.html)
//   POST /api/send     { grid: "<256 x 0|1>", word } from the website
//   GET  /api/stream   Server-Sent Events; the website listens to this on
//                      the laptop the Teensy is plugged into ("connect teensy")
//   GET  /api/status   { bridges }  (public)
//   GET  /api/latest   { latest: { id, word, grid, at, onMatrix } }
//                      admin only: header x-admin-password = ADMIN_PASSWORD
//   POST /api/ack      { id } from the Teensy laptop once the Teensy replied OK
//
// No dependencies: runs on Node 18+ with `node server.js`.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Seconds one visitor has to wait between sends.
// Password for the ADMIN view (see the latest secret). Admin is
// disabled until this is set in the Render environment.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const COOLDOWN_MS = Number(process.env.COOLDOWN_SECONDS || 3) * 1000;

// Orientation fixes, if the word shows up mirrored or upside down on
// the matrix. Set to "1" in the Render environment and restart.
const MIRROR = process.env.MIRROR === '1';   // flip left <-> right
const FLIP = process.env.FLIP === '1';       // flip top <-> bottom

const W = 32;  // website preview: 32 wide
const H = 8;   //                   8 tall (landscape)

const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const bridges = new Set();
const lastSendByIp = new Map();
const adminFails = new Map();   // ip -> { count, until }
let sendCount = 0;

// Last submission, shown to every visitor. onMatrix = Teensy replied OK.
let latest = null;

// ------------------------------------------------------------
// Landscape grid (row by row, 32 x 8) -> Teensy mask order.
//
// The Teensy mask is 8 columns x 32 rows: index = row * 8 + col.
// Matching data.ino ("KEZIA" reads correctly):
//   landscape x (0-31) = mask row
//   landscape y (0-7)  = 7 - mask column
// ------------------------------------------------------------
function gridToMask(grid) {
  const mask = new Array(W * H).fill('0');
  for (let wy = 0; wy < H; wy++) {
    for (let wx = 0; wx < W; wx++) {
      if (grid[wy * W + wx] !== '1') continue;
      const x = MIRROR ? W - 1 - wx : wx;
      const y = FLIP ? H - 1 - wy : wy;
      const row = x;
      const col = H - 1 - y;
      mask[row * H + col] = '1';
    }
  }
  return mask.join('');
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0] : req.socket.remoteAddress || '').trim();
}

function readBody(req, limit, cb) {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > limit) {
      req.destroy();
    }
  });
  req.on('end', () => cb(data));
}

function handleSend(req, res) {
  readBody(req, 4096, (raw) => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { ok: false, error: 'Bad JSON' });
    }

    const grid = String(body.grid || '');
    if (!/^[01]{256}$/.test(grid)) {
      return json(res, 400, { ok: false, error: 'Grid must be 256 zeros/ones' });
    }

    const ip = clientIp(req);
    const now = Date.now();
    const last = lastSendByIp.get(ip) || 0;
    if (now - last < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
      return json(res, 429, { ok: false, error: `Wait ${wait}s before sending again`, wait });
    }
    lastSendByIp.set(ip, now);

    const word = String(body.word || '').toUpperCase().replace(/[^A-Z0-9 !?.\-]/g, '').slice(0, 5);
    const line = 'M' + gridToMask(grid);

    sendCount++;
    latest = { id: sendCount, word, grid, at: new Date().toISOString(), onMatrix: false, delivered: bridges.size > 0 };
    // Only the pixel line goes out: the word stays secret (ADMIN only).
    const msg = JSON.stringify({ id: sendCount, line });
    for (const b of bridges) {
      b.write(`data: ${msg}\n\n`);
    }

    console.log(`send #${sendCount} word="${word}" -> ${bridges.size} bridge(s)`);
    json(res, 200, { ok: true, bridges: bridges.size, wait: COOLDOWN_MS / 1000 });
  });
}

function sameText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function handleLatest(req, res) {
  if (!ADMIN_PASSWORD) {
    return json(res, 503, { ok: false, error: 'ADMIN_PASSWORD is not set on the server' });
  }

  // 5 wrong passwords -> blocked for 60 s.
  const ip = clientIp(req);
  const fail = adminFails.get(ip);
  if (fail && fail.count >= 5 && Date.now() < fail.until) {
    return json(res, 429, { ok: false, error: 'Too many tries, wait a minute' });
  }

  if (!sameText(req.headers['x-admin-password'] || '', ADMIN_PASSWORD)) {
    const f = fail && Date.now() < fail.until ? fail : { count: 0 };
    f.count++;
    f.until = Date.now() + 60000;
    adminFails.set(ip, f);
    return json(res, 401, { ok: false, error: 'Wrong password' });
  }

  adminFails.delete(ip);
  json(res, 200, { ok: true, latest, bridges: bridges.size });
}

function handleAck(req, res) {
  readBody(req, 256, (raw) => {
    let id;
    try { id = Number(JSON.parse(raw).id); } catch { id = NaN; }
    if (latest && latest.id === id) latest.onMatrix = true;
    json(res, 200, { ok: true });
  });
}

function handleStream(req, res, url) {

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  bridges.add(res);
  console.log(`teensy laptop connected (${bridges.size})`);

  // Keep the connection alive through Render's proxy.
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);

  req.on('close', () => {
    clearInterval(ping);
    bridges.delete(res);
    console.log(`teensy laptop disconnected (${bridges.size})`);
  });
}

function serveStatic(res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/send') return handleSend(req, res);
  if (req.method === 'GET' && url.pathname === '/api/stream') return handleStream(req, res, url);
  if (req.method === 'POST' && url.pathname === '/api/ack') return handleAck(req, res);
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { bridges: bridges.size });
  if (req.method === 'GET' && url.pathname === '/api/latest') return handleLatest(req, res);
  if (req.method === 'GET') return serveStatic(res, url.pathname);

  res.writeHead(405);
  res.end();
});

// Forget old rate-limit entries.
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [ip, t] of lastSendByIp) if (t < cutoff) lastSendByIp.delete(ip);
}, 60000);

server.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});
