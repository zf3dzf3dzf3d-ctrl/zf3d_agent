// 朱峰智能体无限 - ZCode 界面替换注入入口
// 原理：Electron 优先加载 resources\app\ 目录而忽略 app.asar
// 还原：删除 C:\Program Files\ZCode\resources\app 目录即恢复原版 ZCode
const { app, BrowserWindow, shell } = require('electron');

const ZF_URL = 'http://127.0.0.1:8793';

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.maximize();
  win.loadURL(ZF_URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ZF_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
