/**
 * The desktop app. Voxelcraft is a web game, so the window is a browser under the skin — but there
 * is no browser around it: no tabs, no address bar, no other pages. It opens straight into the
 * title screen, the way Minecraft does.
 *
 * The game is served over a loopback http server rather than loaded from a file:// path, because
 * the chunk workers and the texture fetches need a real origin to come from.
 */
const { app, BrowserWindow, Menu, shell, screen } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

/** Serves the built game to the window, on a port the operating system picks. */
function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const file = path.join(root, url === '/' ? 'index.html' : url);
      if (!file.startsWith(root)) {
        res.writeHead(403).end('no');
        return;
      }
      fs.readFile(file, (err, body) => {
        if (err) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
        res.end(body);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`));
  });
}

async function createWindow() {
  const url = await serve();
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1280, area.width - 80),
    height: Math.min(760, area.height - 80),
    minWidth: 640,
    minHeight: 480,
    title: 'Voxelcraft',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(root, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // the game locks the pointer the moment you click into the world, as Minecraft does
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  // nothing in the game opens a second page; anything that tries goes to the real browser instead
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12' && input.control) win.webContents.toggleDevTools();
  });
  await win.loadURL(url);
}

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
