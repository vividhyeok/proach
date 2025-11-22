
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
let mainWindow = null;
let defaultBounds = null;

// PDF 파일 선택 IPC 핸들러
ipcMain.handle('select-pdf-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// PDF 파일 복제 IPC 핸들러
ipcMain.handle('copy-pdf-to-app', async (event, srcPath, destName) => {
  try {
    const destDir = path.join(__dirname, '..', 'data', 'pdfs');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const destPath = path.join(destDir, destName);
    await fs.promises.copyFile(srcPath, destPath);
    return destPath;
  } catch (err) {
    return null;
  }
});



function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    alwaysOnTop: false, // 기본값 false
    frame: true,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  defaultBounds = mainWindow.getBounds();

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (isDev && devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    mainWindow.loadFile(indexPath)
  }
}

// PDF 파일을 크롬으로 열기 위한 IPC 핸들러
ipcMain.handle('open-pdf-in-chrome', async (event, pdfPath) => {
  if (pdfPath && mainWindow) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    await shell.openPath(pdfPath);
  }
});

// 오버레이 alwaysOnTop 동적 변경 IPC
ipcMain.handle('set-always-on-top', (event, value) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(!!value);
  }
});

ipcMain.handle('set-window-mode', (event, mode) => {
  if (!mainWindow) return;
  if (mode === 'pip') {
    if (!defaultBounds) {
      defaultBounds = mainWindow.getBounds();
    }
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setSkipTaskbar(false);
    mainWindow.setFullScreenable(false);
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(480, 320);
    const { width, height } = defaultBounds || { width: 1280, height: 800 };
    mainWindow.setBounds({ width: Math.round(width * 0.7), height: Math.round(height * 0.7) });
  } else {
    if (defaultBounds) {
      mainWindow.setBounds(defaultBounds);
    }
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setSkipTaskbar(false);
    mainWindow.setFullScreenable(true);
  }
});

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
