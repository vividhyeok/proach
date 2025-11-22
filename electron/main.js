
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;

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
  const win = new BrowserWindow({
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

  // PDF 파일을 크롬으로 열기 위한 IPC 핸들러
  ipcMain.handle('open-pdf-in-chrome', async (event, pdfPath) => {
    if (pdfPath) {
      win.setAlwaysOnTop(true);
      // shell.openPath를 사용하여 로컬 파일 직접 열기
      await shell.openPath(pdfPath);
    }
  });

  // 오버레이 alwaysOnTop 동적 변경 IPC
  ipcMain.handle('set-always-on-top', (event, value) => {
    win.setAlwaysOnTop(!!value);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (isDev && devServerUrl) {
    win.loadURL(devServerUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    win.loadFile(indexPath)
  }
}

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
