/**
 * A small static server, so the game can be played from a folder. Browsers will not run a page
 * like this one straight off the disk — the workers and the texture files need a real address —
 * so this puts one in front of it and opens it.
 *
 *   node server.mjs [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'game');
const wanted = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  // never serve anything outside the game folder, whatever the address asks for
  if (!file.startsWith(root)) {
    res.writeHead(403).end('no');
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  });
});

/** Takes the next free port if something else already has this one. */
function listen(port, tries = 20) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) listen(port + 1, tries - 1);
    else throw e;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`\n  Voxelcraft is running at ${url}`);
    console.log('  Close this window (or press Ctrl+C) to stop it.\n');
    openWindow(url);
  });
}

/**
 * Opens the game in a window of its own. Chrome and the browsers built on it take , which
 * gives a plain window with no tabs and no address bar — near enough to the desktop app. Failing
 * that, the ordinary browser opens, and failing that the address printed above is the way in.
 */
function openWindow(url) {
  const args = [`--app=${url}`, '--window-size=1280,800'];
  const mac = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'];
  const linux = ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
  const win = ['chrome', 'msedge'];
  const tryRun = (cmd, argv) => {
    try {
      const p = spawn(cmd, argv, { stdio: 'ignore', detached: true });
      p.on('error', () => {});
      p.unref();
      return true;
    } catch {
      return false;
    }
  };
  if (process.platform === 'darwin') {
    for (const app of mac) if (tryRun('open', ['-na', app, '--args', ...args])) return;
    tryRun('open', [url]);
  } else if (process.platform === 'win32') {
    for (const exe of win) if (tryRun('cmd', ['/c', 'start', '', exe, ...args])) return;
    tryRun('cmd', ['/c', 'start', '', url]);
  } else {
    for (const exe of linux) if (tryRun(exe, args)) return;
    tryRun('xdg-open', [url]);
  }
}

listen(wanted);
