import { app, BrowserWindow, utilityProcess, ipcMain, dialog, shell, Menu, nativeImage, screen, contentTracing } from 'electron'
import pkg from 'electron-updater'
import path from 'path'
import { existsSync, mkdirSync, copyFileSync, cpSync, writeFileSync, appendFileSync, readdirSync, readFileSync, renameSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import os from 'os'
import { gzipSync } from 'zlib'

const { autoUpdater } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = process.env.NODE_ENV === 'development'
const PROD_SERVER_PORT = 3456
const SERVER_URL = isDev ? 'http://localhost:3000' : `http://127.0.0.1:${PROD_SERVER_PORT}`

// Only these schemes may be handed to the OS (shell.openExternal also opens
// file:, custom protocol handlers etc., which a link in user content must never reach)
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])
function isSafeExternalUrl(url) {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  }
  catch {
    return false
  }
}
function openExternalSafe(url) {
  if (!isSafeExternalUrl(url)) {
    console.warn('[Electron] Blocked external URL:', url)
    return false
  }
  shell.openExternal(url)
  return true
}

// Linux: Sandbox fix for AppArmor (Ubuntu 24.04+/Kubuntu) and
// force X11 ozone backend to avoid Electron 39 SIGSEGV on Wayland+NVIDIA (#286).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

// ============================================================================
// AUTO-UPDATER CONFIGURATION
// ============================================================================

// In development the auto-updater always runs a mock (no real GitHub fetch,
// no real install). In production the real electron-updater flow is used.
// Mock vs. real is gated on isDev alone — nothing else to toggle, nothing to forget.

// Configure auto-updater
autoUpdater.autoDownload = false // We control when to download
autoUpdater.autoInstallOnAppQuit = false // We control when to install
autoUpdater.logger = console

// Theme colors matching DM Hero
const THEME = {
  dark: {
    background: '#1A1D29',
    titleBarOverlay: {
      color: '#1A1D29',
      symbolColor: '#D4A574', // warm gold for window controls
    },
  },
  light: {
    background: '#F5F1E8',
    titleBarOverlay: {
      color: '#F5F1E8',
      symbolColor: '#8B4513', // saddle brown for window controls
    },
  },
}

// The app was renamed from "DM Hero". Its data folder name is set here so it never depends on
// how the build names the app, and the old folder (campaigns, uploads, settings) is copied over
// once. The old folder stays untouched as a backup.
const APP_NAME = 'DM Command Center'
const OLD_DATA_FOLDERS = ['DM Hero', '@dm-hero/app']
const NOT_COPIED = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'logs', 'mcp', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'])

function useRenamedDataFolder() {
  if (isDev) return
  app.setName(APP_NAME)
  // An explicit --user-data-dir (the smoke test's fresh profile) wins
  if (app.commandLine.hasSwitch('user-data-dir')) return
  const newDir = path.join(app.getPath('appData'), APP_NAME)
  app.setPath('userData', newDir)
  if (existsSync(path.join(newDir, 'data', 'dm-hero.db'))) return
  const oldDir = OLD_DATA_FOLDERS.map(name => path.join(app.getPath('appData'), name))
    .find(dir => existsSync(path.join(dir, 'data', 'dm-hero.db')))
  if (!oldDir) return
  const copying = path.join(newDir, 'data.copying')
  try {
    mkdirSync(newDir, { recursive: true })
    for (const entry of readdirSync(oldDir)) {
      if (entry === 'data' || NOT_COPIED.has(entry)) continue
      cpSync(path.join(oldDir, entry), path.join(newDir, entry), { recursive: true, force: false })
    }
    // Database last and all at once: a half-finished copy never counts as done
    rmSync(copying, { recursive: true, force: true })
    cpSync(path.join(oldDir, 'data'), copying, { recursive: true })
    renameSync(copying, path.join(newDir, 'data'))
    console.log('[Electron] Copied data from', oldDir)
  }
  catch (error) {
    console.error('[Electron] Copying data from the old app folder failed:', error)
    rmSync(copying, { recursive: true, force: true })
    // Keep working on the old folder rather than starting empty
    app.setPath('userData', oldDir)
  }
}
useRenamedDataFolder()

// Graphics options from Settings > More > Graphics check (they need a restart)
// forceGpu: use the graphics card even where Chromium would fall back to slower drawing
function graphicsPrefsFile() {
  return path.join(app.getPath('userData'), 'graphics.json')
}
function readGraphicsPrefs() {
  try {
    return JSON.parse(readFileSync(graphicsPrefsFile(), 'utf-8'))
  }
  catch {
    return {}
  }
}
function writeGraphicsPrefs(changes) {
  try {
    writeFileSync(graphicsPrefsFile(), JSON.stringify({ ...readGraphicsPrefs(), ...changes }))
  }
  catch (err) {
    console.error('[Electron] Saving graphics settings failed:', err)
  }
}
if (readGraphicsPrefs().forceGpu) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
}

// mainProcessGpu (Windows): draw from the window's own process.
// Chromium normally draws from a separate helper process. Graphics drivers decide what is
// "in the background" by which process owns the active window, so they appear to take the
// helper for a background app: a trace showed every frame held for 50 ms (NVIDIA "Background Application Max Frame
// Rate"), capping the app at 20 fps while Chrome, which drivers know, stayed smooth.
// That limit is NVIDIA's, and on a laptop the same switch left the window empty, so it is
// automatic only where it is needed: an NVIDIA card with no Intel/AMD chip beside it (a
// desktop). The cards are read after each start (gpus) and used from the next start, so a
// new PC starts the safe way once. The Settings switch overrides this (true/false).
// If a window ever fails to show with it, the next start switches it off.
const isWindowsPlatform = process.platform === 'win32'
const VENDOR_NVIDIA = 0x10DE
const VENDOR_INTEL = 0x8086
const VENDOR_AMD = 0x1002

function wantsMainProcessGpu(prefs) {
  if (typeof prefs.mainProcessGpu === 'boolean') return prefs.mainProcessGpu
  const gpus = Array.isArray(prefs.gpus) ? prefs.gpus : []
  return gpus.some(g => g.active && g.vendorId === VENDOR_NVIDIA)
    && !gpus.some(g => g.vendorId === VENDOR_INTEL || g.vendorId === VENDOR_AMD)
}

if (isWindowsPlatform) {
  const prefs = readGraphicsPrefs()
  if (prefs.startPending && wantsMainProcessGpu(prefs)) {
    console.warn('[Electron] Last start did not reach the window, drawing from the helper process again')
    writeGraphicsPrefs({ mainProcessGpu: false, startPending: false })
  }
  else if (wantsMainProcessGpu(prefs)) {
    app.commandLine.appendSwitch('in-process-gpu')
  }
}

// Remembers this PC's graphics cards for the automatic choice above
async function rememberGpus() {
  const info = await app.getGPUInfo('basic').catch(() => null)
  const gpus = (info?.gpuDevice ?? []).map(d => ({ vendorId: d.vendorId, deviceId: d.deviceId, active: !!d.active }))
  if (gpus.length) writeGraphicsPrefs({ gpus })
}

let mainWindow = null
let serverProcess = null
let serverErrors = ''

/**
 * Get user data paths for database, uploads, and logs
 * In production, these are in app.getPath('userData')
 * In dev mode, these are not used (Nuxt dev server uses default paths)
 */
function getDataPaths() {
  if (isDev) {
    return null // Dev mode uses default paths
  }

  const userDataPath = app.getPath('userData')
  const dataDir = path.join(userDataPath, 'data')
  const uploadsDir = path.join(userDataPath, 'uploads')
  const logsDir = path.join(userDataPath, 'logs')

  const audioDir = path.join(uploadsDir, 'audio')

  // Ensure directories exist
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true })
  }
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true })
  }
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }

  return {
    databasePath: path.join(dataDir, 'dm-hero.db'),
    uploadPath: uploadsDir,
    logsPath: logsDir,
  }
}

/**
 * Start the Nitro server as a utility process (production only)
 */
async function startServer() {
  if (isDev) {
    console.log('[Electron] Dev mode - using external Nuxt dev server')
    return
  }

  const paths = getDataPaths()

  // Find server path - check multiple locations for packaged vs dev
  const possiblePaths = [
    // Packaged with extraResources: resources/.output/...
    path.join(process.resourcesPath, '.output', 'server', 'index.mjs'),
    // Packaged without ASAR: resources/app/.output/...
    path.join(process.resourcesPath, 'app', '.output', 'server', 'index.mjs'),
    // Packaged with ASAR unpacked: resources/app.asar.unpacked/.output/...
    path.join(process.resourcesPath, 'app.asar.unpacked', '.output', 'server', 'index.mjs'),
    // Dev mode: project root/.output/...
    path.join(__dirname, '..', '.output', 'server', 'index.mjs'),
  ]

  let serverPath = null
  for (const p of possiblePaths) {
    console.log('[Electron] Checking path:', p, 'exists:', existsSync(p))
    if (existsSync(p)) {
      serverPath = p
      break
    }
  }

  if (!serverPath) {
    console.error('[Electron] Server not found! Checked paths:', possiblePaths)
    console.error('[Electron] Run "pnpm build" first!')
    app.quit()
    return
  }

  const serverDir = path.dirname(serverPath)
  const outputDir = path.dirname(serverDir) // .output folder

  console.log('[Electron] Starting Nitro server...')
  console.log('[Electron]   Server path:', serverPath)
  console.log('[Electron]   Output dir:', outputDir)
  console.log('[Electron]   DATABASE_PATH:', paths.databasePath)
  console.log('[Electron]   UPLOAD_PATH:', paths.uploadPath)
  console.log('[Electron]   LOG_PATH:', paths.logsPath)

  // Make the bundled MCP reachable at a STABLE path. In an AppImage,
  // process.resourcesPath lives under a per-launch /tmp/.mount_* directory that
  // changes on every start — so the path a user registers in their MCP client
  // (`claude mcp add … <path>`) would break after the next restart. Copy the
  // bin into userData (stable across restarts/updates) on each launch and hand
  // THAT path to the "Connect your AI" dialog instead.
  let mcpPath = path.join(process.resourcesPath, 'mcp', 'mcp.mjs')
  try {
    if (existsSync(mcpPath)) {
      const stableDir = path.join(app.getPath('userData'), 'mcp')
      mkdirSync(stableDir, { recursive: true })
      const stableMcp = path.join(stableDir, 'mcp.mjs')
      copyFileSync(mcpPath, stableMcp)
      mcpPath = stableMcp
      console.log('[Electron] MCP staged at stable path:', stableMcp)
    }
    else {
      console.warn('[Electron] Bundled MCP not found at', mcpPath)
    }
  }
  catch (err) {
    console.error('[Electron] Failed to stage MCP bin:', err)
  }

  // Start server as utility process with environment variables
  serverProcess = utilityProcess.fork(serverPath, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PROD_SERVER_PORT),
      DATABASE_PATH: paths.databasePath,
      UPLOAD_PATH: paths.uploadPath,
      LOG_PATH: paths.logsPath,
      NITRO_OUTPUT_DIR: outputDir,
      // For the dashboard "Connect your AI" dialog: the app's API URL + the
      // stable MCP bin path (copied from resources/mcp/mcp.mjs to userData).
      DM_HERO_APP_URL: `http://127.0.0.1:${PROD_SERVER_PORT}`,
      DM_HERO_MCP_PATH: mcpPath,
      // The app's own executable runs the MCP as plain Node (ELECTRON_RUN_AS_NODE),
      // so connecting an AI doesn't need a separate Node.js install
      DM_HERO_NODE_PATH: process.execPath,
    },
    cwd: outputDir,
    stdio: 'pipe',
  })

  // Log server output
  serverProcess.stdout?.on('data', (data) => {
    console.log('[Server]', data.toString().trim())
  })

  serverProcess.stderr?.on('data', (data) => {
    const text = data.toString().trim()
    console.error('[Server Error]', text)
    // Kept so a failed start can say why
    serverErrors = (serverErrors + '\n' + text).slice(-4000)
  })

  serverProcess.on('exit', (code) => {
    console.log('[Electron] Server process exited with code:', code)
    serverProcess = null
  })

  // Wait for server to be ready
  // A static file answers as soon as the server listens (no page render); slow PCs get 2 minutes
  await waitForServer(`http://127.0.0.1:${PROD_SERVER_PORT}/favicon.png`, 120000)
  console.log('[Electron] Server is ready!')
}

/**
 * Wait for server to respond
 */
async function waitForServer(url, timeout = 30000) {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok || response.status === 404) {
        return true
      }
    }
    catch {
      // Server not ready yet
    }
    // A crashed server never answers: stop waiting instead of sitting out the timeout
    if (!serverProcess) throw new Error('The app\'s server stopped while starting')
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  throw new Error(`Server did not start within ${timeout}ms`)
}

/**
 * Stop the server process
 */
function stopServer() {
  if (serverProcess) {
    console.log('[Electron] Stopping server...')
    serverProcess.kill()
    serverProcess = null
  }
}

function createWindow() {
  console.log('[Electron] Creating window...')
  console.log('[Electron] isDev:', isDev)
  console.log('[Electron] Platform:', process.platform)

  // Start with dark theme (default)
  const currentTheme = THEME.dark

  // Platform-specific window options
  // Windows: Custom titlebar with overlay controls
  // Linux/macOS: Native titlebar (titleBarOverlay not supported on Linux)
  const isWindows = process.platform === 'win32'

  const windowOptions = {
    width: 1400,
    height: 900,
    title: 'DM: Command Center',
    backgroundColor: currentTheme.background,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  }

  // Set up minimal menu (macOS + Linux)
  // Windows uses custom titlebar, so no menu needed
  if (!isWindows) {
    const template = [
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'DM: Command Center',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
          ]
        : []),
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Documentation',
            click: () => shell.openExternal('https://dm-hero.com/docs'),
          },
          {
            label: 'Report Issue',
            click: () => shell.openExternal('https://github.com/Flo0806/dm-hero/issues'),
          },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  if (isWindows) {
    windowOptions.titleBarStyle = 'hidden'
    windowOptions.titleBarOverlay = currentTheme.titleBarOverlay
  }
  else {
    // Linux/macOS: Hide menu bar for cleaner look
    windowOptions.autoHideMenuBar = true
    // Set window icon (Linux needs this explicitly, Windows/macOS use app bundle icon)
    // In packaged app: use extraResources path (outside asar), fallback to dev path
    // Use 256x256 icon for reliable Linux taskbar display
    const iconName = 'icon-256.png'
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, iconName)
      : path.join(__dirname, 'icons', iconName)
    windowOptions.icon = nativeImage.createFromPath(iconPath)
  }

  // Cleared once the window shows (see mainProcessGpu above)
  if (app.commandLine.hasSwitch('in-process-gpu')) writeGraphicsPrefs({ startPending: true })
  mainWindow = new BrowserWindow(windowOptions)

  mainWindow.once('ready-to-show', () => {
    console.log('[Electron] Window ready to show')
    if (readGraphicsPrefs().startPending) writeGraphicsPrefs({ startPending: false })
    mainWindow.show()
    if (isWindowsPlatform) rememberGpus()
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.error(`[Electron] Failed to load: ${errorCode} ${errorDescription}`)
  })

  // Load the appropriate URL
  const serverUrl = SERVER_URL
  console.log('[Electron] Loading URL:', serverUrl)

  // Everything that is not our own server (YouTube, Tabletop Audio, docs, …)
  // opens in the system browser instead of taking over the app window.
  const isAppUrl = url => url.startsWith(serverUrl)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' }
    openExternalSafe(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openExternalSafe(url)
  })

  mainWindow.loadURL(serverUrl)

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }
}

// IPC Handlers for data management
// What the window draws with: tells a slow window (software drawing, blocked GPU) apart
// from a slow page, which Chrome would show too
ipcMain.handle('get-graphics-info', async () => {
  const gpu = await app.getGPUInfo('complete').catch(() => null)
  return {
    featureStatus: app.getGPUFeatureStatus(),
    renderer: gpu?.auxAttributes?.glRenderer ?? null,
    devices: (gpu?.gpuDevice ?? []).map(d => ({ active: d.active, vendorId: d.vendorId, deviceId: d.deviceId, driver: d.driverVersion })),
    displays: screen.getAllDisplays().map(d => ({ hz: d.displayFrequency, scale: d.scaleFactor, width: d.size.width, primary: d.id === screen.getPrimaryDisplay().id })),
    windowDisplayHz: mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()).displayFrequency : null,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    forceGpu: readGraphicsPrefs().forceGpu === true,
    mainProcessGpu: isWindowsPlatform ? app.commandLine.hasSwitch('in-process-gpu') : null,
  }
})

// Performance recording (Settings > More > Graphics check): a Chromium trace of every
// process (window, page, graphics card, server) plus CPU use per process, so a stutter
// can be traced to the thread that causes it instead of guessed at. Runs here so it
// keeps going while the person switches pages; the file is shown in Explorer when done.
const TRACE_SECONDS = 15
const TRACE_CATEGORIES = [
  'toplevel', 'benchmark', 'input', 'latencyInfo', 'cc', 'viz', 'gpu', 'gpu.service', 'blink',
  'renderer.scheduler', 'scheduler', 'devtools.timeline', 'v8', 'ipc', 'mojom', 'electron',
  'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-viz.display', 'disabled-by-default-gpu.service',
]
let traceRunning = false

async function recordPerformanceTrace() {
  const metrics = []
  const sampler = setInterval(() => {
    metrics.push({
      t: Date.now(),
      processes: app.getAppMetrics().map(m => ({ type: m.type, name: m.name ?? m.serviceName ?? '', pid: m.pid, cpu: m.cpu.percentCPUUsage })),
    })
  }, 500)
  try {
    await contentTracing.startRecording({ included_categories: TRACE_CATEGORIES, excluded_categories: ['*'] })
    await new Promise(resolve => setTimeout(resolve, TRACE_SECONDS * 1000))
    const rawPath = await contentTracing.stopRecording()
    const gpu = await app.getGPUInfo('complete').catch(() => null)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const outPath = path.join(app.getPath('downloads'), `DM-CC-performance-${stamp}.json.gz`)
    // Context for reading the trace, added to the same file so only one file is sent
    const info = {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      windows: os.release(),
      cpus: os.cpus().length,
      switches: process.argv.slice(1),
      mainProcessGpu: app.commandLine.hasSwitch('in-process-gpu'),
      renderer: gpu?.auxAttributes?.glRenderer ?? null,
      featureStatus: app.getGPUFeatureStatus(),
      displays: screen.getAllDisplays().map(d => ({ hz: d.displayFrequency, scale: d.scaleFactor, width: d.size.width, primary: d.id === screen.getPrimaryDisplay().id })),
      windowDisplayHz: mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()).displayFrequency : null,
      metrics,
    }
    // Spliced in as text: the trace can be hundreds of MB, too big to parse here
    const raw = readFileSync(rawPath, 'utf-8').trimEnd()
    const trace = raw.endsWith('}') ? `${raw.slice(0, -1)},"dmccInfo":${JSON.stringify(info)}}` : raw
    writeFileSync(outPath, gzipSync(trace))
    rmSync(rawPath, { force: true })
    shell.showItemInFolder(outPath)
  }
  finally {
    clearInterval(sampler)
    traceRunning = false
  }
}

ipcMain.handle('record-performance-trace', () => {
  if (traceRunning) return { started: false, seconds: TRACE_SECONDS }
  traceRunning = true
  recordPerformanceTrace().catch((err) => {
    console.error('[Electron] Performance recording failed:', err)
    dialog.showErrorBox('Performance recording failed', String(err?.message ?? err))
  })
  return { started: true, seconds: TRACE_SECONDS }
})

// Saves the choice and restarts, since Chromium reads these switches only at startup
ipcMain.handle('set-graphics-prefs', (event, prefs = {}) => {
  const changes = {}
  if (typeof prefs.forceGpu === 'boolean') changes.forceGpu = prefs.forceGpu
  if (typeof prefs.mainProcessGpu === 'boolean') changes.mainProcessGpu = prefs.mainProcessGpu
  writeGraphicsPrefs(changes)
  app.relaunch()
  app.quit()
  return { success: true }
})

ipcMain.handle('get-data-paths', () => {
  if (isDev) {
    // Dev mode uses project-local paths
    return {
      databasePath: path.join(process.cwd(), 'data', 'dm-hero.db'),
      uploadPath: path.join(process.cwd(), 'uploads'),
      logsPath: path.join(process.cwd(), 'data', 'logs'),
    }
  }
  return getDataPaths()
})

ipcMain.handle('export-database', async () => {
  // Generate default filename with timestamp
  const timestamp = new Date().toISOString().split('T')[0]
  const defaultFilename = `dm-hero-backup-${timestamp}.db`

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Database',
    defaultPath: defaultFilename,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  })

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true }
  }

  try {
    // The server writes a consistent snapshot (the raw .db file misses data still in the WAL)
    const response = await fetch(`${SERVER_URL}/api/backup`, { method: 'POST' })
    if (!response.ok) throw new Error(`Backup failed (${response.status})`)
    const backup = await response.json()
    copyFileSync(backup.path, result.filePath)
    return { success: true, filePath: result.filePath }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

// Copy a database file the user picks into the backup folder, so it can be restored from Settings
ipcMain.handle('import-backup-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Backup',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) {
    return { success: false, canceled: true }
  }

  try {
    const response = await fetch(`${SERVER_URL}/api/backups`)
    if (!response.ok) throw new Error(`Could not read backup folder (${response.status})`)
    const { directory } = await response.json()
    const name = `dm-hero-imported-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
    copyFileSync(result.filePaths[0], path.join(directory, name))
    return { success: true, name }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('open-uploads-folder', async () => {
  const paths = isDev
    ? { uploadPath: path.join(process.cwd(), 'uploads') }
    : getDataPaths()

  if (!existsSync(paths.uploadPath)) {
    mkdirSync(paths.uploadPath, { recursive: true })
  }

  try {
    await shell.openPath(paths.uploadPath)
    return { success: true }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('open-logs-folder', async () => {
  const paths = isDev
    ? { logsPath: path.join(process.cwd(), 'data', 'logs') }
    : getDataPaths()

  if (!existsSync(paths.logsPath)) {
    mkdirSync(paths.logsPath, { recursive: true })
  }

  try {
    await shell.openPath(paths.logsPath)
    return { success: true }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

// TaleSpire dice links: only talespire://dice/Name:2d6+3[/Name:...], never any other
// TaleSpire URL (those can e.g. join boards). TaleSpire puts the dice in the tray.
const TALESPIRE_DICE = /^talespire:\/\/dice\/[A-Za-z0-9]{1,32}:[0-9dD+-]{1,40}(\/[A-Za-z0-9]{1,32}:[0-9dD+-]{1,40}){0,5}$/
ipcMain.handle('open-talespire-dice', async (event, url) => {
  if (typeof url !== 'string' || !TALESPIRE_DICE.test(url)) {
    return { success: false, error: 'Not a TaleSpire dice link' }
  }
  try {
    await shell.openExternal(url)
    return { success: true }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

// TaleSpire panel ("symbiote"): copy it into TaleSpire's Symbiotes folder with
// this app's address and key. Without a folder, TaleSpire's default one is used.
ipcMain.handle('install-talespire-panel', async (event, { url, key, folder } = {}) => {
  if (typeof url !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || typeof key !== 'string' || !/^[a-f0-9]{16,128}$/.test(key)) {
    return { success: false, error: 'Bad panel settings' }
  }
  const source = app.isPackaged
    ? path.join(process.resourcesPath, 'talespire-symbiote')
    : path.join(__dirname, '..', 'talespire-symbiote')
  let symbiotes = typeof folder === 'string' && folder ? folder : null
  if (!symbiotes) {
    const localLow = path.join(app.getPath('appData'), '..', 'LocalLow', 'BouncyRock Entertainment', 'TaleSpire')
    if (!existsSync(localLow)) return { success: false, notFound: true }
    symbiotes = path.join(localLow, 'Symbiotes')
  }
  try {
    const target = path.join(symbiotes, 'DM Command Center')
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true })
    writeFileSync(
      path.join(target, 'config.js'),
      `// Written by DM Command Center when it installs this panel\nwindow.DMCC_CONFIG = ${JSON.stringify({ url, key })}\n`,
    )
    return { success: true, path: target }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

// Open external URL in system browser
ipcMain.handle('open-external-url', async (event, url) => {
  if (!isSafeExternalUrl(url)) {
    return { success: false, error: 'URL scheme not allowed' }
  }
  try {
    await shell.openExternal(url)
    return { success: true }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

// ============================================================================
// AUTO-UPDATER IPC HANDLERS
// ============================================================================

// Path of the downloaded update file (set in update-downloaded event).
// On Linux, AppImage cannot self-replace, so we expose this so the renderer
// can open the containing folder for the user.
let downloadedUpdateFile = null

// Check for updates
ipcMain.handle('check-for-updates', async () => {
  if (isDev) {
    // DEV MODE: Simulate update available
    console.log('[AutoUpdater] DEV MODE: Simulating update available')
    return {
      updateAvailable: true,
      version: '99.0.0-test',
      releaseNotes: 'This is a test update for development',
      isDevMode: true,
    }
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (result?.updateInfo) {
      const currentVersion = app.getVersion()
      const latestVersion = result.updateInfo.version
      // Only show update if latest version is actually newer
      const isNewer = latestVersion !== currentVersion
      console.log(`[AutoUpdater] Current: ${currentVersion}, Latest: ${latestVersion}, isNewer: ${isNewer}`)
      return {
        updateAvailable: isNewer,
        version: latestVersion,
        releaseNotes: result.updateInfo.releaseNotes,
        isDevMode: false,
      }
    }
    return { updateAvailable: false }
  }
  catch (error) {
    console.error('[AutoUpdater] Check failed:', error.message)
    return { updateAvailable: false, error: error.message }
  }
})

// Start downloading the update
ipcMain.handle('download-update', async () => {
  // Reset stale cached path so "show in folder" can't reveal a previous download.
  downloadedUpdateFile = null

  if (isDev) {
    // DEV MODE: Simulate download progress
    console.log('[AutoUpdater] DEV MODE: Simulating download...')

    // Simulate progress events
    const simulateProgress = async () => {
      for (let percent = 0; percent <= 100; percent += 10) {
        await new Promise(resolve => setTimeout(resolve, 300))
        if (mainWindow) {
          mainWindow.webContents.send('update-download-progress', {
            percent,
            bytesPerSecond: 1024 * 1024 * 2, // 2 MB/s
            transferred: percent * 10000,
            total: 1000000,
          })
        }
      }
      // Simulate download complete.
      // Use the running executable as a stand-in so showItemInFolder has a real file to reveal.
      downloadedUpdateFile = app.getPath('exe')
      if (mainWindow) {
        mainWindow.webContents.send('update-downloaded', {
          version: '99.0.0-test',
          downloadedFile: downloadedUpdateFile,
        })
      }
    }

    simulateProgress()
    return { started: true, isDevMode: true }
  }

  try {
    await autoUpdater.downloadUpdate()
    return { started: true }
  }
  catch (error) {
    console.error('[AutoUpdater] Download failed:', error.message)
    return { started: false, error: error.message }
  }
})

// Install update and restart
ipcMain.handle('install-update', async () => {
  if (isDev) {
    // DEV MODE: Just show a message, don't actually restart
    console.log('[AutoUpdater] DEV MODE: Would install and restart here')
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Dev Mode',
        message: 'In production, the app would now restart and install the update.',
        buttons: ['OK'],
      })
    }
    return { installed: false, isDevMode: true }
  }

  autoUpdater.quitAndInstall(false, true)
  return { installed: true }
})

// Reveal the downloaded update file in the OS file manager.
// Used on Linux where AppImage cannot self-install via quitAndInstall.
ipcMain.handle('show-update-file', async () => {
  if (!downloadedUpdateFile) {
    return { shown: false, error: 'No downloaded update file available' }
  }
  // File may have been deleted between download and click (cache cleanup, manual rm).
  if (!existsSync(downloadedUpdateFile)) {
    downloadedUpdateFile = null
    return { shown: false, error: 'Downloaded update file no longer exists' }
  }
  shell.showItemInFolder(downloadedUpdateFile)
  return { shown: true, path: downloadedUpdateFile }
})

// Auto-updater events -> send to renderer
autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version)
  if (mainWindow) {
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    })
  }
})

autoUpdater.on('update-not-available', () => {
  console.log('[AutoUpdater] No update available')
  if (mainWindow) {
    mainWindow.webContents.send('update-not-available')
  }
})

autoUpdater.on('download-progress', (progress) => {
  console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`)
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', progress)
  }
})

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Update downloaded:', info.version, 'file:', info.downloadedFile)
  downloadedUpdateFile = info.downloadedFile || null
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', {
      version: info.version,
      downloadedFile: downloadedUpdateFile,
    })
  }
})

autoUpdater.on('error', (error) => {
  console.error('[AutoUpdater] Error:', error.message)
  if (mainWindow) {
    mainWindow.webContents.send('update-error', {
      message: error.message,
    })
  }
})

// ============================================================================
// FILE DIALOG IPC HANDLERS
// ============================================================================

// Save file with dialog (for campaign exports)
// Pick a folder (music library)
ipcMain.handle('select-folder-dialog', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths.length) {
    return { success: false, canceled: true }
  }
  return { success: true, folderPath: result.filePaths[0] }
})

ipcMain.handle('save-file-dialog', async (event, options) => {
  const { defaultFileName, fileData, filters } = options

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultFileName,
    filters: filters || [
      { name: 'DM Hero Campaign', extensions: ['dmhero'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true }
  }

  try {
    // fileData is an ArrayBuffer from the renderer
    const buffer = Buffer.from(fileData)
    writeFileSync(result.filePath, buffer)
    return { success: true, filePath: result.filePath }
  }
  catch (error) {
    return { success: false, error: error.message }
  }
})

// ============================================================================
// UNCAUGHT EXCEPTION HANDLER
// ============================================================================

function logToFile(message) {
  try {
    const paths = getDataPaths()
    const logsDir = paths?.logsPath || path.join(process.cwd(), 'data', 'logs')

    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true })
    }

    const logFile = path.join(logsDir, 'dm-hero.log')
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const logLine = `[${timestamp}] [FATAL] [Electron Main] ${message}\n`

    appendFileSync(logFile, logLine, 'utf-8')
  }
  catch (err) {
    console.error('[Electron] Failed to write to log file:', err)
  }
}

process.on('uncaughtException', (error) => {
  const message = `Uncaught Exception: ${error.message}\n${error.stack || ''}`
  console.error('[Electron]', message)
  logToFile(message)
})

process.on('unhandledRejection', (reason) => {
  const message = `Unhandled Rejection: ${reason instanceof Error ? reason.message + '\n' + reason.stack : String(reason)}`
  console.error('[Electron]', message)
  logToFile(message)
})

// App lifecycle
app.whenReady().then(async () => {
  try {
    await startServer()
    createWindow()
  }
  catch (error) {
    console.error('[Electron] Failed to start:', error)
    // Never vanish silently: write down why and tell the user where to find it
    const details = `${error instanceof Error ? error.message : String(error)}${serverErrors ? `\n\nServer output:\n${serverErrors}` : ''}`
    logToFile(`Failed to start: ${details}`)
    const logsDir = getDataPaths()?.logsPath
    dialog.showErrorBox('DM Command Center could not start', `${details.slice(0, 1500)}${logsDir ? `\n\nThe full report is in:\n${path.join(logsDir, 'dm-hero.log')}` : ''}`)
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopServer()
})

app.on('quit', () => {
  stopServer()
})
