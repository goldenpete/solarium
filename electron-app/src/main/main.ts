import { app, BrowserWindow, session, ipcMain, shell, Menu, MenuItem, clipboard, dialog, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { ExtensionManager } from './ExtensionManager'

let settingsWindow: BrowserWindow | null = null

// Register chrome-extension scheme as privileged to allow Service Workers
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'chrome-extension',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

// Helper to calculate folder size
const getFolderSize = (dirPath: string): number => {
  let size = 0
  try {
    if (!fs.existsSync(dirPath)) return 0
    const files = fs.readdirSync(dirPath)
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) {
        size += getFolderSize(filePath)
      } else {
        size += stats.size
      }
    }
  } catch (error) {
    console.error(`Error calculating size for ${dirPath}:`, error)
  }
  return size
}

// Disable background throttling for extensions
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// Global WebContents handler to intercept all new window requests from webviews
app.on('web-contents-created', (event, contents) => {
  // We only want to intercept requests from <webview> tags (the tabs)
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      console.log('Webview requested new window:', url)

      if (url.startsWith('devtools://')) {
        return { action: 'allow' }
      }

      // Find the main window to send the command to
      // We exclude the settings window and destroyed windows
      const mainWindow = BrowserWindow.getAllWindows().find(w => w !== settingsWindow && !w.isDestroyed())

      if (mainWindow) {
        mainWindow.webContents.send('create-tab', url)
      } else {
        console.log('No main window found to handle new tab')
      }

      return { action: 'deny' }
    })

    // Also handle "will-navigate" to prevent the webview from navigating the whole window?
    // Not needed for webviews usually.
  }
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // No top bar as requested
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      webviewTag: true, // Enable webview for browser functionality
      nodeIntegration: true, // simplified for this demo, usually false
      contextIsolation: false, // simplified for this demo, usually true
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist-new/index.html'))
  }

  // Handle external links and webview new-window requests that bubble up
  win.webContents.setWindowOpenHandler(({ url }) => {
    // If it's a web URL, open in a new tab inside the app
    if (url.startsWith('http://') || url.startsWith('https://')) {
      win.webContents.send('create-tab', url)
      return { action: 'deny' }
    }

    // Otherwise (mailto:, file:, etc.) let OS handle it
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

app.whenReady().then(async () => {
  const extensionsPath = path.join(app.getPath('userData'), 'extensions')

  // Ensure directory exists
  if (!fs.existsSync(extensionsPath)) {
    fs.mkdirSync(extensionsPath, { recursive: true })
  }

  // Set User Agent to allow Chrome Web Store access
  // Using a recent stable Chrome version to ensure compatibility
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  session.defaultSession.setUserAgent(userAgent)
  app.userAgentFallback = userAgent

  // Site Statuses
  const siteStatuses: Record<string, 'block' | 'limit' | 'trusted' | null> = {}
  let trackingProtectionEnabled = true
  let blockedTrackersCount = 0

  // Basic Blocklist (Ad/Tracker Domains)
  const TRACKER_PATTERNS = [
    // DoubleClick
    "*://*.doubleclick.net/*",
    "*://*.googleadservices.com/*",
    "*://*.googlesyndication.com/*",
    "*://*.moatads.com/*",
    // Analytics
    "*://*.google-analytics.com/*",
    "*://*.hotjar.com/*",
    "*://*.segment.io/*",
    // Social Trackers
    "*://*.facebook.com/tr/*",
    "*://connect.facebook.net/*",
    "*://platform.twitter.com/*",
    // Ad Networks
    "*://*.adnxs.com/*",
    "*://*.criteo.com/*",
    "*://*.advertising.com/*",
    "*://*.pubmatic.com/*",
    "*://*.rubiconproject.com/*",
    "*://*.openx.net/*",
    "*://*.amazon-adsystem.com/*",
    "*://*.scorecardresearch.com/*",
    "*://*.zedo.com/*",
    "*://*.adsafeprotected.com/*",
    "*://*.quantserve.com/*"
  ]

  ipcMain.handle('update-site-status', (_event, site: string, status: 'block' | 'limit' | 'trusted' | null) => {
    siteStatuses[site] = status
    console.log(`Updated status for ${site} to ${status}`)
  })

  ipcMain.handle('set-tracking-protection', (_event, enabled: boolean) => {
    trackingProtectionEnabled = enabled
    console.log(`Tracking protection set to ${enabled}`)
    return true
  })

  ipcMain.handle('get-blocked-count', () => {
    return blockedTrackersCount
  })

  // Web Request Blocking & Headers
  // session.defaultSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
  //   try {
  //     // Don't block main frame navigations (allows user to visit sites even if they match patterns)
  //     if (details.resourceType === 'mainFrame') {
  //       callback({ cancel: false })
  //       return
  //     }

  //     const url = new URL(details.url)
  //     const hostname = url.hostname

  //     // 1. Check Site Status (Manual Block)
  //     // Check if any blocked site is part of the hostname
  //     // e.g. "google.com" blocks "www.google.com" and "google.com"
  //     const blocked = Object.entries(siteStatuses).find(([site, status]) =>
  //       status === 'block' && (hostname === site || hostname.endsWith('.' + site))
  //     )

  //     if (blocked) {
  //       console.log(`Blocking request to ${details.url} because ${blocked[0]} is blocked`)
  //       callback({ cancel: true })
  //       return
  //     }

  //     // 2. Tracking Protection
  //     if (trackingProtectionEnabled) {
  //       // Simple pattern matching for now
  //       // In a real browser, we would use a trie or a more efficient matcher like adblock-rust
  //       const isTracker = TRACKER_PATTERNS.some(pattern => {
  //         // Very basic glob matching
  //         const cleanPattern = pattern.replace(new RegExp('\\*', 'g'), '.*')
  //         const regex = new RegExp('^' + cleanPattern + '$')
  //         return regex.test(details.url)
  //       })

  //       if (isTracker) {
  //         blockedTrackersCount++
  //         console.log(`Blocked tracker: ${details.url}`)
  //         // Notify all windows (renderer) about the block
  //         BrowserWindow.getAllWindows().forEach(win => {
  //           win.webContents.send('tracker-blocked', details.url)
  //         })
  //         callback({ cancel: true })
  //         return
  //       }
  //     }

  //   } catch (e) {
  //     // Invalid URL, ignore
  //   }
  //   callback({ cancel: false })
  // })

  // Permission handling is now in ExtensionManager

  // Spoof Client Hints & Handle "Limit" status (Strip Cookies) - REMOVED to allow Extensions to handle this
  // session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
  //   callback({ cancel: false, requestHeaders: details.requestHeaders })
  // })

  // Handle "Limit" status - Prevent saving cookies (Set-Cookie) - REMOVED to allow Extensions to handle this
  // session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  //   callback({ cancel: false, responseHeaders: details.responseHeaders })
  // })

  // Handle Downloads (CRX downloads are handled by ExtensionManager)
  session.defaultSession.on('will-download', (_event, item, _webContents) => {
    const filename = item.getFilename().toLowerCase()
    if (filename.endsWith('.crx') || filename.endsWith('.crx3')) {
      return // Handled by ExtensionManager.setupCRXHandler()
    }

    console.log(`Starting download: ${item.getFilename()}`)

    // If it's a CRX/CRX3 file from the web store, we might want to handle it specially in the future
    // For now, let it save to the default downloads directory
    item.on('updated', (_event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed')
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused')
        } else {
          // console.log(`Received bytes: ${item.getReceivedBytes()}`)
        }
      }
    })

    item.once('done', (_event, state) => {
      if (state === 'completed') {
        console.log('Download successfully')
      } else {
        console.log(`Download failed: ${state}`)
      }
    })
  })

  // ─── Extension Manager ─────────────────────────────────────────────────
  const extensionManager = new ExtensionManager()
  extensionManager.setupCRXHandler()

  // Context Menu IPC
  ipcMain.handle('show-context-menu', (event, params) => {
    const menu = new Menu()

    // Navigation
    menu.append(new MenuItem({
      label: 'Back',
      enabled: params.canGoBack,
      click: () => event.sender.send('context-menu-command', 'goBack')
    }))
    menu.append(new MenuItem({
      label: 'Forward',
      enabled: params.canGoForward,
      click: () => event.sender.send('context-menu-command', 'goForward')
    }))
    menu.append(new MenuItem({
      label: 'Reload',
      click: () => event.sender.send('context-menu-command', 'reload')
    }))

    menu.append(new MenuItem({ type: 'separator' }))

    // Link actions
    if (params.linkURL && params.linkURL.length > 0) {
      menu.append(new MenuItem({
        label: 'Open Link in New Tab',
        click: () => event.sender.send('context-menu-command', 'openLinkInNewTab', params.linkURL)
      }))
      menu.append(new MenuItem({
        label: 'Copy Link Address',
        click: () => {
          clipboard.writeText(params.linkURL)
        }
      }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    // Text actions
    if (params.selectionText && params.selectionText.length > 0) {
      menu.append(new MenuItem({
        label: 'Copy',
        role: 'copy'
      }))
      menu.append(new MenuItem({
        label: 'Search Google for "' + (params.selectionText.length > 20 ? params.selectionText.substring(0, 20) + '...' : params.selectionText) + '"',
        click: () => event.sender.send('context-menu-command', 'searchGoogle', params.selectionText)
      }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    // Standard Edit actions (if not just text selection)
    menu.append(new MenuItem({ role: 'cut' }))
    menu.append(new MenuItem({ role: 'copy' }))
    menu.append(new MenuItem({ role: 'paste' }))
    menu.append(new MenuItem({ role: 'selectAll' }))

    menu.append(new MenuItem({ type: 'separator' }))

    // Dev Tools
    menu.append(new MenuItem({
      label: 'Inspect Element',
      click: () => event.sender.send('context-menu-command', 'inspectElement', { x: params.x, y: params.y })
    }))

    const win = BrowserWindow.fromWebContents(event.sender)
    menu.popup({ window: win || undefined })
  })

  // Tab Context Menu IPC
  ipcMain.handle('show-tab-context-menu', (event, params) => {
    const menu = new Menu()
    const { tabId } = params

    menu.append(new MenuItem({
      label: 'New Tab',
      click: () => event.sender.send('tab-context-menu-command', 'newTab', tabId)
    }))

    menu.append(new MenuItem({ type: 'separator' }))

    menu.append(new MenuItem({
      label: 'Reload',
      click: () => event.sender.send('tab-context-menu-command', 'reload', tabId)
    }))

    menu.append(new MenuItem({
      label: 'Duplicate',
      click: () => event.sender.send('tab-context-menu-command', 'duplicate', tabId)
    }))

    menu.append(new MenuItem({ type: 'separator' }))

    const isPinned = params.type === 'pinned'
    const isFavorite = params.type === 'favorite'

    menu.append(new MenuItem({
      label: isPinned ? 'Unpin Tab' : 'Pin Tab',
      click: () => event.sender.send('tab-context-menu-command', 'togglePin', tabId)
    }))

    menu.append(new MenuItem({
      label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
      click: () => event.sender.send('tab-context-menu-command', 'toggleFavorite', tabId)
    }))

    menu.append(new MenuItem({ type: 'separator' }))

    menu.append(new MenuItem({
      label: 'Close Tab',
      click: () => event.sender.send('tab-context-menu-command', 'close', tabId)
    }))

    menu.append(new MenuItem({
      label: 'Close Other Tabs',
      click: () => event.sender.send('tab-context-menu-command', 'closeOthers', tabId)
    }))

    menu.append(new MenuItem({
      label: 'Close Tabs to Right',
      enabled: params.hasTabsToRight,
      click: () => event.sender.send('tab-context-menu-command', 'closeRight', tabId)
    }))

    const win = BrowserWindow.fromWebContents(event.sender)
    menu.popup({ window: win || undefined })
  })

  // Get cookies for a specific domain
  ipcMain.handle('get-cookies', async (_event, domain) => {
    try {
      const cookies = await session.defaultSession.cookies.get({ domain })
      return cookies
    } catch (error) {
      console.error('Error getting cookies:', error)
      return []
    }
  })

  // Get all cookies (for aggregating sites)
  ipcMain.handle('get-all-cookies', async () => {
    try {
      const cookies = await session.defaultSession.cookies.get({})
      return cookies
    } catch (error) {
      console.error('Error getting all cookies:', error)
      return []
    }
  })

  // Remove cookies for a specific domain
  ipcMain.handle('remove-cookies-for-domain', async (_event, domain) => {
    try {
      const cookies = await session.defaultSession.cookies.get({})
      const domainCookies = cookies.filter(c => c.domain && c.domain.includes(domain))

      for (const cookie of domainCookies) {
        let url = ''
        if (cookie.secure) {
          url += 'https://'
        } else {
          url += 'http://'
        }
        if (cookie.domain && cookie.domain.startsWith('.')) {
          url += cookie.domain.substring(1)
        } else {
          url += cookie.domain
        }
        url += cookie.path

        await session.defaultSession.cookies.remove(url, cookie.name)
      }
      return true
    } catch (error) {
      console.error('Error removing cookies:', error)
      return false
    }
  })

  // Clear cache for a specific domain
  ipcMain.handle('clear-cache-for-domain', async (_event, domain) => {
    try {
      // Handle domain variations (remove leading dot if present)
      const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;

      const origins = [
        `https://${cleanDomain}`,
        `http://${cleanDomain}`
      ];

      // Add www variation if not present
      if (!cleanDomain.startsWith('www.')) {
        origins.push(`https://www.${cleanDomain}`);
        origins.push(`http://www.${cleanDomain}`);
      }

      for (const origin of origins) {
        await session.defaultSession.clearStorageData({
          storages: ['shadercache', 'serviceworkers', 'cachestorage'],
          origin: origin
        });
      }
      return true;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return false;
    }
  })

  // Remove specific site data types
  ipcMain.handle('remove-site-data', async (_event, { domain, types }) => {
    try {
      const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
      const origins = [
        `https://${cleanDomain}`,
        `http://${cleanDomain}`
      ];
      if (!cleanDomain.startsWith('www.')) {
        origins.push(`https://www.${cleanDomain}`);
        origins.push(`http://www.${cleanDomain}`);
      }

      // Map simplified types to Electron storage types
      const storages: string[] = []

      // Granular mappings
      if (types.includes('cookies')) storages.push('cookies')
      if (types.includes('localstorage')) storages.push('localstorage', 'websql')
      if (types.includes('filesystem')) storages.push('filesystem')
      if (types.includes('indexdb')) storages.push('indexdb')
      if (types.includes('serviceworkers')) storages.push('serviceworkers')
      if (types.includes('cachestorage')) storages.push('cachestorage', 'cache')
      if (types.includes('appcache')) storages.push('appcache')
      if (types.includes('shadercache')) storages.push('shadercache')

      // Legacy/Grouped mappings (for backward compatibility or convenience)
      if (types.includes('storage')) storages.push('localstorage', 'websql', 'filesystem')

      if (storages.length > 0) {
        for (const origin of origins) {
          // @ts-ignore - Electron types might not be perfectly up to date with allowed strings
          await session.defaultSession.clearStorageData({
            storages: storages as ("cookies" | "indexdb" | "serviceworkers" | "filesystem" | "shadercache" | "localstorage" | "cachestorage" | "websql")[],
            origin: origin
          });
        }
      }
      return true
    } catch (error) {
      console.error('Error removing site data:', error)
      return false
    }
  })

  // Get site data usage
  ipcMain.handle('get-site-data-usage', async (_event, domain) => {
    try {
      const usage = {
        cookies: { count: 0, size: 0 },
        indexdb: 0,
        localstorage: 0,
        serviceworkers: 0,
        cachestorage: 0
      }

      // 1. Calculate Cookie Size
      // We get all cookies for the domain (including subdomains if domain starts with .)
      const cookies = await session.defaultSession.cookies.get({ domain: domain })
      usage.cookies.count = cookies.length
      usage.cookies.size = cookies.reduce((acc, cookie) => acc + cookie.name.length + cookie.value.length, 0)

      // 2. Calculate IndexedDB Size
      // IndexedDB folders are in userData/IndexedDB
      // Naming format: protocol_domain_0.indexeddb.leveldb
      const userDataPath = app.getPath('userData')
      const indexedDbPath = path.join(userDataPath, 'IndexedDB')

      if (fs.existsSync(indexedDbPath)) {
        const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain

        // Generate possible folder names
        const possibleFolders = [
          `https_${cleanDomain}_0.indexeddb.leveldb`,
          `http_${cleanDomain}_0.indexeddb.leveldb`,
          `https_www.${cleanDomain}_0.indexeddb.leveldb`,
          `http_www.${cleanDomain}_0.indexeddb.leveldb`
        ]

        for (const folder of possibleFolders) {
          const folderPath = path.join(indexedDbPath, folder)
          if (fs.existsSync(folderPath)) {
            usage.indexdb += getFolderSize(folderPath)
          }
        }
      }

      // 3. Other types are harder to estimate per-domain without internal APIs
      // returning 0 or -1 (unknown) is appropriate.
      // We'll leave them as 0 (implying < 1KB or unknown)

      return usage
    } catch (error) {
      console.error('Error getting site usage:', error)
      return null
    }
  })

  // Open Extensions Folder
  ipcMain.handle('open-extensions-folder', async () => {
    const extensionsPath = path.join(app.getPath('userData'), 'extensions')
    // Ensure directory exists
    if (!fs.existsSync(extensionsPath)) {
      fs.mkdirSync(extensionsPath, { recursive: true })
    }
    await shell.openPath(extensionsPath)
  })

  // Settings Window IPC
  ipcMain.handle('open-settings-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus()
      return
    }

    settingsWindow = new BrowserWindow({
      width: 900,
      height: 700,
      frame: false,
      backgroundColor: '#09090b',
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    if (process.env.VITE_DEV_SERVER_URL) {
      settingsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?window=settings`)
    } else {
      settingsWindow.loadFile(path.join(__dirname, '../dist-new/index.html'), { search: 'window=settings' })
    }

    // Handle external links in settings
    settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
      // Send to main window to open in tab
      const mainWindows = BrowserWindow.getAllWindows().filter(w => w !== settingsWindow && !w.isDestroyed())
      if (mainWindows.length > 0) {
        mainWindows[0].webContents.send('create-tab', url)
      } else {
        shell.openExternal(url)
      }
      return { action: 'deny' }
    })
  })

  ipcMain.on('create-tab-from-settings', (_event, url) => {
    const mainWindows = BrowserWindow.getAllWindows().filter(w => w !== settingsWindow && !w.isDestroyed())
    if (mainWindows.length > 0) {
      mainWindows[0].webContents.send('create-tab', url)
    }
  })

  ipcMain.on('update-search-engine', (_event, engine) => {
    // Broadcast to all windows
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('search-engine-updated', engine)
    })
  })

  const mainWindow = createWindow()
  await extensionManager.initialize(mainWindow)

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
