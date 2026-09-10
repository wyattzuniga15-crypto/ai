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
 * Opens the game in a window of its own. Chrome and the browsers built on it take `--app`, which
 * gives a plain window with no tabs and no address bar — near enough to the desktop app.
 *
 * The browser has to be found on disk first: asking the shell to start one that is not installed
 * fails quietly long after we have stopped watching, so there would be nothing to fall back from.
 */
function openWindow(url) {
  const args = [`--app=${url}`, '--window-size=1280,800'];
  const env = (name) => process.env[name] || '';
  let candidates = [];
  if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app',
      '/Applications/Microsoft Edge.app',
      '/Applications/Brave Browser.app',
      '/Applications/Chromium.app',
      `${env('HOME')}/Applications/Google Chrome.app`,
    ];
  } else if (process.platform === 'win32') {
    candidates = [
      `${env('LOCALAPPDATA')}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env('ProgramFiles')}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env('ProgramFiles(x86)')}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env('ProgramFiles(x86)')}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${env('ProgramFiles')}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ];
  } else {
    for (const exe of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
      for (const dir of (env('PATH') || '').split(':')) {
        if (dir && fs.existsSync(path.join(dir, exe))) candidates.push(path.join(dir, exe));
      }
    }
  }
  const found = candidates.find((c) => c && fs.existsSync(c));
  const run = (cmd, argv) => {
    try {
      const child = spawn(cmd, argv, { stdio: 'ignore', detached: true, windowsHide: false });
      child.on('error', () => {});
      child.unref();
    } catch {
      // nothing to open it with, which is what the printed address is for
    }
  };
  if (found && process.platform === 'darwin') run('open', ['-na', found, '--args', ...args]);
  else if (found) run(found, args);
  else if (process.platform === 'darwin') run('open', [url]);
  else if (process.platform === 'win32') run('cmd', ['/c', 'start', '', url]);
  else run('xdg-open', [url]);
}

listen(wanted);
