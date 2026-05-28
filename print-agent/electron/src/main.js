const { app, BrowserWindow, Tray, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const multer = require('multer');
const { print, getPrinters } = require('pdf-to-printer');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  port: 9100,
  defaultPrinter: '',
  copies: 1,
  paperSize: '',
  silent: true,
  allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'],
};

let mainWindow = null;
let tray = null;
let server = null;
let config = loadConfig();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
    }
  } catch (e) {
    console.error('config load failed:', e);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(next) {
  config = { ...config, ...next };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

function startHttpServer() {
  const expressApp = express();
  const upload = multer({ dest: os.tmpdir() });

  expressApp.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || config.allowedOrigins.includes(origin) || origin.startsWith('http://localhost')) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  expressApp.get('/status', (_req, res) => {
    res.json({
      ok: true,
      version: app.getVersion(),
      defaultPrinter: config.defaultPrinter,
      platform: process.platform,
    });
  });

  expressApp.get('/printers', async (_req, res) => {
    try {
      const list = await getPrinters();
      res.json({ ok: true, printers: list });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  expressApp.post('/print', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file uploaded' });
    const printer = req.body.printer || config.defaultPrinter;
    const copies = Number(req.body.copies || config.copies || 1);
    try {
      const opts = { printer: printer || undefined, copies, silent: config.silent };
      if (config.paperSize) opts.paperSize = config.paperSize;
      await print(req.file.path, opts);
      fs.unlink(req.file.path, () => {});
      res.json({ ok: true, printer: printer || 'default' });
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server = expressApp.listen(config.port, '127.0.0.1', () => {
      console.log(`Print agent listening on http://127.0.0.1:${config.port}`);
      resolve();
    });
    server.on('error', reject);
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'tray.ico' : 'tray.png');
  const fallbackIcon = require('electron').nativeImage.createEmpty();
  tray = new Tray(fs.existsSync(iconPath) ? iconPath : fallbackIcon);
  tray.setToolTip(`SS ERP 打印代理 :${config.port}`);
  const menu = Menu.buildFromTemplate([
    { label: `状态：监听 :${config.port}`, enabled: false },
    { label: '打开配置窗口', click: () => createWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => createWindow());
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    title: 'SS ERP 打印代理',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'config.html'));
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:save', (_e, next) => saveConfig(next));
ipcMain.handle('printers:list', async () => {
  try { return { ok: true, printers: await getPrinters() }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('print:test', async (_e, printer) => {
  const testPdf = path.join(__dirname, 'assets', 'test.pdf');
  if (!fs.existsSync(testPdf)) return { ok: false, error: 'test.pdf not found' };
  try {
    await print(testPdf, { printer: printer || config.defaultPrinter || undefined, silent: config.silent });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(async () => {
  try {
    await startHttpServer();
    createTray();
    if (process.argv.includes('--show-config')) createWindow();
  } catch (e) {
    dialog.showErrorBox('启动失败', `端口 ${config.port} 占用或权限不足：${e.message}`);
    app.quit();
  }
});

app.on('window-all-closed', (e) => { e.preventDefault(); });
app.on('before-quit', () => {
  app.isQuiting = true;
  if (server) server.close();
});
