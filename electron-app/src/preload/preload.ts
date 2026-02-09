import { contextBridge } from 'electron'

// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

// Spoof navigator.webdriver to pass some anti-bot checks
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  })
} catch (e) {
  console.error('Failed to spoof navigator.webdriver', e)
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Add any needed IPC bridges here
})
