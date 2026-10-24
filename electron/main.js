'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const path = require('node:path');
const { createUpdaterService } = require('./updater/service');
const { createPrintersService } = require('./printers/service');
const powershell = require('./printers/powershell');
const net = require('./printers/net');
const repo = require('./printers/repo');

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';

/* ─────────────── Janela principal ─────────────── */
let mainWin = null;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#050506',
    title: 'Toni Infra Kit',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    frame: isMac, // Windows/Linux: title bar própria do design system (tk-titlebar)
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWin = win;

  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  win.on('closed', () => { if (mainWin === win) mainWin = null; });

  // Links externos abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function showMain() {
  if (!mainWin) { createMainWindow(); return; }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

const broadcast = (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload); };

/* ─────────────── IPC ─────────────── */
const fromEvent = (e) => BrowserWindow.fromWebContents(e.sender);

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
}));

ipcMain.on('win:minimize', (e) => fromEvent(e)?.minimize());
ipcMain.on('win:toggle-maximize', (e) => {
  const w = fromEvent(e);
  if (w) (w.isMaximized() ? w.unmaximize() : w.maximize());
});
ipcMain.on('win:close', (e) => fromEvent(e)?.close());

ipcMain.handle('theme:set', (_e, theme) => {
  // Qualquer tema que não seja claro/sistema é uma variante escura — o chrome nativo só entende claro/escuro/sistema.
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

// https em qualquer lugar; http só para IP privado (página de administração da impressora, que quase nunca tem https).
const PRIVATE_IP = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
ipcMain.handle('shell:open-url', (_e, url) => {
  const u = new URL(String(url));
  const ok = u.protocol === 'https:' || (u.protocol === 'http:' && PRIVATE_IP.test(u.hostname));
  if (!ok) throw new Error('Só links https (ou http para a página de uma impressora na rede local) são permitidos');
  return shell.openExternal(u.toString());
});

/* ─────────────── Impressoras ─────────────── */
let printers = null;

function initPrinters() {
  printers = createPrintersService({
    file: path.join(app.getPath('userData'), 'printers.json'),
    repoFile: path.join(app.getPath('userData'), 'printers-repo.json'),
    run: powershell.run,
    runElevated: powershell.runElevated,
    net,
    repo,
    broadcast: (s) => broadcast('printers:changed', s),
  });
  // Inventário local já na abertura: a lista aparece com as filas instaladas antes da primeira varredura.
  printers.refreshLocal().catch((e) => console.error('[printers]', e));
}

ipcMain.handle('printers:get', () => printers.get());
ipcMain.handle('printers:refresh', () => printers.refreshLocal());
ipcMain.handle('printers:scan', (_e, opts) => printers.scan(opts || {}));
ipcMain.handle('printers:cancel-scan', () => printers.cancelScan());
ipcMain.handle('printers:driver-options', (_e, id) => printers.driverOptions(String(id)));
ipcMain.handle('printers:install', (_e, req) => printers.install(req || {}));
ipcMain.handle('printers:test', (_e, queue) => printers.testPage(String(queue)));
ipcMain.handle('printers:remove', (_e, queue) => printers.remove(String(queue)));
ipcMain.handle('printers:set-default', (_e, queue) => printers.setDefault(String(queue)));
ipcMain.handle('printers:open-queue', (_e, queue) => printers.openQueue(String(queue)));
ipcMain.handle('printers:set-settings', (_e, patch) => printers.setSettings(patch || {}));
ipcMain.handle('printers:reindex', () => printers.reindex());
ipcMain.handle('printers:log', () => printers.getLog());
ipcMain.handle('printers:clear-log', () => printers.clearLog());
ipcMain.handle('printers:pick-folder', async (e) => {
  const { dialog } = require('electron');
  const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Pasta de drivers', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

/* ─────────────── Atualização ─────────────── */
// Windows instalado (NSIS): electron-updater troca os arquivos sozinho. Portátil: só avisa e abre a release.
let updater = null;

function initUpdater() {
  updater = createUpdaterService({
    isPackaged: app.isPackaged,
    platform: process.platform,
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
    currentVersion: app.getVersion(),
    broadcast: (s) => broadcast('updater:changed', s),
  });
  if (updater.get().mode === 'unsupported') return;
  let lastCheck = 0;
  const checkIfStale = (minMs) => {
    if (Date.now() - lastCheck < minMs) return;
    lastCheck = Date.now();
    updater.check().catch(() => {});
  };
  setTimeout(() => checkIfStale(0), 15_000);
  const interval = setInterval(() => checkIfStale(0), 4 * 60 * 60 * 1000);
  if (interval.unref) interval.unref();
  app.on('browser-window-focus', (_e, win) => { if (win === mainWin) checkIfStale(10 * 60 * 1000); });
}

ipcMain.handle('updater:status', () => updater.get());
ipcMain.handle('updater:check', () => updater.check());
ipcMain.handle('updater:download', () => updater.download());
ipcMain.handle('updater:install', () => updater.install());

/* ─────────────── Ciclo de vida ─────────────── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  // AppUserModelId próprio (ícone e nome certos na barra de tarefas); o sufixo .dev separa do app instalado.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'io.github.tonissx.toniinfrakit' : 'io.github.tonissx.toniinfrakit.dev');

  app.whenReady().then(() => {
    initPrinters();
    initUpdater();
    createMainWindow();
    app.on('activate', () => showMain());
  });

  let flushed = false;
  app.on('before-quit', (e) => {
    if (flushed || !printers) return;
    e.preventDefault();
    printers.flush().catch(() => {}).finally(() => { flushed = true; app.quit(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
