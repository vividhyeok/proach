export interface ElectronAPI {
  selectPdfFile: () => Promise<string | null>;
  copyPdfToApp: (srcPath: string, destName: string) => Promise<string | null>;
  openPdfInChrome: (pdfPath: string) => Promise<void>;
  setAlwaysOnTop?: (value: boolean) => Promise<void>;
  setWindowMode?: (mode: 'pip' | 'default') => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
