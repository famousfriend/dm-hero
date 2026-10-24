// The page only needs to know it runs inside the desktop app
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', { isElectron: true })
