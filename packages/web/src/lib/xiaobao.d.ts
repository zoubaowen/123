interface XiaoBaoAPI {
  platform: string
  getPythonPath(): Promise<string>
  execPython(scriptPath: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
  execPipInstall(pkgName: string): Promise<{ success: boolean; output?: string; error?: string }>
  getArduinoCliPath(): Promise<string | null>
  execArduino(args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number; error?: string }>
  takeScreenshot(): Promise<string | null>
  showOpenDialog(options: Record<string, unknown>): Promise<Electron.OpenDialogReturnValue>
  getHermesHome(): Promise<string>
  getAppVersion(): Promise<string>
  shellOpenExternal(url: string): Promise<void>
  setAutoStart(enabled: boolean): Promise<void>
  exportSessions(): Promise<string | null>
  importSessions(): Promise<{ count: number }>
  onUpdateAvailable(callback: () => void): void
  onUpdateDownloaded(callback: () => void): void
}

declare namespace Electron {
  interface OpenDialogReturnValue {
    canceled: boolean
    filePaths: string[]
  }
}

interface Window {
  xiaobao?: XiaoBaoAPI
}
