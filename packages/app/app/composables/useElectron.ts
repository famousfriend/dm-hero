/**
 * Composable for Electron-specific functionality
 *
 * Provides access to Electron APIs when running in desktop mode.
 * Falls back gracefully in browser mode.
 */

// Types for Electron API exposed via preload
export interface SaveFileOptions {
  defaultFileName: string
  fileData: ArrayBuffer
  filters?: Array<{ name: string, extensions: string[] }>
}

export interface SaveFileResult {
  success: boolean
  canceled?: boolean
  filePath?: string
  error?: string
}

// Auto-updater types
export interface UpdateCheckResult {
  updateAvailable: boolean
  version?: string
  releaseNotes?: string
  isDevMode?: boolean
  error?: string
}

export interface UpdateDownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

/** Settings > More > Graphics check: what the desktop window draws with */
export interface GraphicsInfo {
  featureStatus: Record<string, string>
  renderer: string | null
  devices: { active: boolean, vendorId: number, deviceId: number, driver?: string }[]
  displays: { hz: number, scale: number, width: number, primary: boolean }[]
  windowDisplayHz: number | null
  chrome: string
  electron: string
  forceGpu: boolean
}

export interface ElectronAPI {
  isElectron: boolean
  exportDatabase: () => Promise<{ success: boolean, canceled?: boolean, filePath?: string, error?: string }>
  importBackupFile: () => Promise<{ success: boolean, canceled?: boolean, name?: string, error?: string }>
  openUploadsFolder: () => Promise<{ success: boolean, error?: string }>
  openLogsFolder: () => Promise<{ success: boolean, error?: string }>
  getDataPaths: () => Promise<{ databasePath: string, uploadPath: string, logsPath: string }>
  saveFileDialog: (options: SaveFileOptions) => Promise<SaveFileResult>
  openExternalUrl: (url: string) => Promise<{ success: boolean, error?: string }>
  openTaleSpireDice?: (url: string) => Promise<{ success: boolean, error?: string }>
  getGraphicsInfo?: () => Promise<GraphicsInfo>
  setGraphicsPrefs?: (prefs: { forceGpu: boolean }) => Promise<{ success: boolean }>
  installTaleSpirePanel?: (options: { url: string, key: string, folder?: string }) => Promise<{ success: boolean, notFound?: boolean, path?: string, error?: string }>
  selectFolderDialog: (options?: { title?: string, defaultPath?: string }) => Promise<{ success: boolean, canceled?: boolean, folderPath?: string }>

  // Auto-updater APIs
  checkForUpdates: () => Promise<UpdateCheckResult>
  downloadUpdate: () => Promise<{ started: boolean, isDevMode?: boolean, error?: string }>
  installUpdate: () => Promise<{ installed: boolean, isDevMode?: boolean }>
  showUpdateFile: () => Promise<{ shown: boolean, path?: string, error?: string }>

  // Auto-updater event listeners
  onUpdateAvailable: (callback: (data: { version: string, releaseNotes?: string }) => void) => void
  onUpdateNotAvailable: (callback: () => void) => void
  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => void
  onUpdateDownloaded: (callback: (data?: { version?: string, downloadedFile?: string }) => void) => void
  onUpdateError: (callback: (error: { message: string }) => void) => void
  removeUpdateListeners: () => void

  // Platform identifier from process.platform
  platform: NodeJS.Platform
}

// Extend Window interface with electronAPI
declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// Singleton to avoid repeated window checks
let _isElectron: boolean | null = null
let _electronAPI: ElectronAPI | null = null

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  if (_isElectron === null) {
    _isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron
  }
  return _isElectron
}

/**
 * Get the Electron API (only available in Electron)
 */
export function getElectronAPI(): ElectronAPI | null {
  if (!isElectron()) return null

  if (_electronAPI === null) {
    _electronAPI = window.electronAPI!
  }
  return _electronAPI
}

/**
 * Composable for Electron functionality
 */
export function useElectron() {
  const electronAPI = getElectronAPI()

  return {
    isElectron: isElectron(),
    electronAPI,

    /**
     * Save a file with a save dialog (Electron only)
     * Falls back to browser download if not in Electron
     */
    async saveFile(blob: Blob, defaultFileName: string, filters?: SaveFileOptions['filters']): Promise<{ success: boolean, error?: string }> {
      if (electronAPI) {
        // Electron: Show save dialog (default filter: .dmhero campaigns)
        const arrayBuffer = await blob.arrayBuffer()
        const result = await electronAPI.saveFileDialog({
          defaultFileName,
          fileData: arrayBuffer,
          ...(filters ? { filters } : {}),
        })
        return result
      }
      else {
        // Browser: Standard download
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultFileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return { success: true }
      }
    },

    /**
     * Export the database (Electron only)
     */
    async exportDatabase(): Promise<{ success: boolean, canceled?: boolean, filePath?: string, error?: string }> {
      if (!electronAPI) {
        return { success: false, error: 'Not running in Electron' }
      }
      return electronAPI.exportDatabase()
    },

    /**
     * Copy a .db file the user picks into the backup folder (Electron only)
     */
    async importBackupFile(): Promise<{ success: boolean, canceled?: boolean, name?: string, error?: string }> {
      if (!electronAPI) {
        return { success: false, error: 'Not running in Electron' }
      }
      return electronAPI.importBackupFile()
    },

    /**
     * Open the uploads folder in file explorer (Electron only)
     */
    async openUploadsFolder(): Promise<{ success: boolean, error?: string }> {
      if (!electronAPI) {
        return { success: false, error: 'Not running in Electron' }
      }
      return electronAPI.openUploadsFolder()
    },

    /**
     * Open the logs folder in file explorer (Electron only)
     */
    async openLogsFolder(): Promise<{ success: boolean, error?: string }> {
      if (!electronAPI) {
        return { success: false, error: 'Not running in Electron' }
      }
      return electronAPI.openLogsFolder()
    },

    /**
     * Get data paths (database, uploads, and logs)
     */
    async getDataPaths(): Promise<{ databasePath: string, uploadPath: string, logsPath: string } | null> {
      if (!electronAPI) return null
      return electronAPI.getDataPaths()
    },

    /**
     * Native folder picker (Electron only, returns null in the browser)
     */
    async selectFolder(options?: { title?: string, defaultPath?: string }): Promise<string | null> {
      if (!electronAPI?.selectFolderDialog) return null
      const result = await electronAPI.selectFolderDialog(options)
      return result.success && result.folderPath ? result.folderPath : null
    },

    /**
     * Open external URL in system browser
     * Falls back to window.open if not in Electron
     */
    async openExternalUrl(url: string): Promise<{ success: boolean, error?: string }> {
      if (electronAPI) {
        return electronAPI.openExternalUrl(url)
      }
      else {
        window.open(url, '_blank')
        return { success: true }
      }
    },
  }
}
