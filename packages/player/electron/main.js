/**
 * DM Command Center - Player Companion: desktop shell.
 * Starts the bundled Nitro server and shows it in a window, like DM Command
 * Center does (packages/app/electron/main.js), on its own port and data folder
 * so both apps can run side by side.
 */
import { app, BrowserWindow, Menu, nativeImage, shell, utilityProcess, dialog } from 'electron'
import path from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'
const PROD_SERVER_PORT = 3457 // DM Command Center uses 3456
const SERVER_URL = isDev ? 'http://localhost:3001' : `http://127.0.0.1:${PROD_SERVER_PORT}`
const BACKGROUND = '#1A1D29'

if (!app.requestSingleInstanceLock()) app.quit()

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

// Windows + NVIDIA desktop: draw from the window's own process, or the driver's
// background frame limit caps the app at 20 fps. Same rule as DM Command Center
// (see its main.js for the trace that found it); graphics.json can override.
const VENDOR_NVIDIA = 0x10DE
const VENDOR_INTEL = 0x8086
const VENDOR_AMD = 0x1002
const graphicsFile = () => path.join(app.getPath('userData'), 'graphics.json')
function readGraphics() {
  try {
    return JSON.parse(readFileSync(graphicsFile(), 'utf-8'))
  }
  catch {
    return {}
  }
}
function writeGraphics(changes) {
  try {
    writeFileSync(graphicsFile(), JSON.stringify({ ...readGraphics(), ...changes }))
  }
  catch (err) {
    console.error('[Electron] Saving graphics settings failed:', err)
  }
}
function wantsMainProcessGpu(prefs) {
  if (typeof prefs.mainProcessGpu === 'boolean') return prefs.mainProcessGpu
  const gpus = Array.isArray(prefs.gpus) ? prefs.gpus : []
  return gpus.some(g => g.active && g.vendorId === VENDOR_NVIDIA)
    && !gpus.some(g => g.vendorId === VENDOR_INTEL || g.vendorId === VENDOR_AMD)
}
if (process.platform === 'win32') {
  const prefs = readGraphics()
  if (prefs.startPending && wantsMainProcessGpu(prefs)) writeGraphics({ mainProcessGpu: false, startPending: false })
  else if (wantsMainProcessGpu(prefs)) app.commandLine.appendSwitch('in-process-gpu')
}

let mainWindow = null
let serverProcess = null
let serverErrors = ''

function openExternalSafe(url) {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url)
  }
  catch {
    // Not a URL: ignore
  }
}

function findServer() {
  const candidates = [
    path.join(process.resourcesPath, '.output', 'server', 'index.mjs'),
    path.join(__dirname, '..', '.output', 'server', 'index.mjs'),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

async function waitForServer(url, timeout) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok || response.status === 404) return
    }
    catch {
      // Not listening yet
    }
    if (!serverProcess) throw new Error('The app\'s server stopped while starting')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Server did not start within ${timeout}ms`)
}

async function startServer() {
  if (isDev) return
  const serverPath = findServer()
  if (!serverPath) throw new Error('The app\'s server files are missing. Please reinstall.')
  const dataDir = path.join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })
  const outputDir = path.dirname(path.dirname(serverPath))
  serverProcess = utilityProcess.fork(serverPath, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PROD_SERVER_PORT),
      DATABASE_PATH: path.join(dataDir, 'player-companion.db'),
      NITRO_OUTPUT_DIR: outputDir,
    },
    cwd: outputDir,
    stdio: 'pipe',
  })
  serverProcess.stdout?.on('data', data => console.log('[Server]', data.toString().trim()))
  serverProcess.stderr?.on('data', (data) => {
    const text = data.toString().trim()
    console.error('[Server Error]', text)
    serverErrors = (serverErrors + '\n' + text).slice(-4000)
  })
  serverProcess.on('exit', () => {
    serverProcess = null
  })
  await waitForServer(`http://127.0.0.1:${PROD_SERVER_PORT}/favicon.png`, 120000)
}

function stopServer() {
  serverProcess?.kill()
  serverProcess = null
}

function createWindow() {
  const isWindows = process.platform === 'win32'
  const options = {
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'DM CC Player Companion',
    backgroundColor: BACKGROUND,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  }
  if (isWindows) {
    options.titleBarStyle = 'hidden'
    options.titleBarOverlay = { color: BACKGROUND, symbolColor: '#D4A574' }
  }
  else {
    options.autoHideMenuBar = true
    const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon-256.png') : path.join(__dirname, 'icons', 'icon-256.png')
    options.icon = nativeImage.createFromPath(iconPath)
    Menu.setApplicationMenu(null)
  }

  if (app.commandLine.hasSwitch('in-process-gpu')) writeGraphics({ startPending: true })
  mainWindow = new BrowserWindow(options)
  mainWindow.once('ready-to-show', async () => {
    if (readGraphics().startPending) writeGraphics({ startPending: false })
    mainWindow.show()
    if (isWindows) {
      const info = await app.getGPUInfo('basic').catch(() => null)
      const gpus = (info?.gpuDevice ?? []).map(d => ({ vendorId: d.vendorId, deviceId: d.deviceId, active: !!d.active }))
      if (gpus.length) writeGraphics({ gpus })
    }
  })

  // Links to anything but our own server open in the system browser
  const isAppUrl = url => url.startsWith(SERVER_URL)
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
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.loadURL(SERVER_URL)
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  try {
    await startServer()
  }
  catch (err) {
    dialog.showErrorBox('Player Companion could not start', `${err.message}\n${serverErrors}`.trim())
    app.quit()
    return
  }
  createWindow()
})

app.on('window-all-closed', () => {
  stopServer()
  app.quit()
})

app.on('before-quit', stopServer)
