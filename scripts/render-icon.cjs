// Gera os PNGs do ícone a partir de renderer/assets/symbol.svg: npm run icon
// (roda dentro do Electron para usar o mesmo Chromium do app; saída 512×512 com fundo transparente)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const SIZE = 512;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'renderer', 'assets', 'symbol.svg'));
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${svg.toString('base64')}" style="width:${SIZE}px;height:${SIZE}px;display:block"></body></html>`;
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 } });
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 400));
  const img = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' });
  const png = img.toPNG();
  for (const out of [path.join(root, 'build', 'icon.png'), path.join(root, 'renderer', 'assets', 'icon.png')]) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);
    console.log('ícone gravado em', path.relative(root, out));
  }
  app.quit();
});
