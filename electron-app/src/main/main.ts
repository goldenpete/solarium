import { app, BrowserWindow, session, ipcMain, shell, Menu, MenuItem, clipboard, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

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

function createWindow() {
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
}

app.whenReady().then(async () => {
  const extensionsPath = path.join(app.getPath('userData'), 'extensions')
  
  // Ensure directory exists
  if (!fs.existsSync(extensionsPath)) {
    fs.mkdirSync(extensionsPath, { recursive: true })
  }

  // Set User Agent to allow Chrome Web Store access
  // Updated to Chrome 146 (future-proof for 2026) to avoid "Item currently unavailable" errors
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
  session.defaultSession.setUserAgent(userAgent)
  app.userAgentFallback = userAgent

  // Site Statuses
  const siteStatuses: Record<string, 'block' | 'limit' | 'trusted' | null> = {}

  ipcMain.handle('update-site-status', (_event, site: string, status: 'block' | 'limit' | 'trusted' | null) => {
    siteStatuses[site] = status
    console.log(`Updated status for ${site} to ${status}`)
  })

  // Web Request Blocking & Headers
  // Block blocked sites
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
        const url = new URL(details.url)
        const hostname = url.hostname
        
        // Check if any blocked site is part of the hostname
        // e.g. "google.com" blocks "www.google.com" and "google.com"
        const blocked = Object.entries(siteStatuses).find(([site, status]) => 
            status === 'block' && (hostname === site || hostname.endsWith('.' + site))
        )

        if (blocked) {
            console.log(`Blocking request to ${details.url} because ${blocked[0]} is blocked`)
            callback({ cancel: true })
            return
        }
    } catch (e) {
        // Invalid URL, ignore
    }
    callback({ cancel: false })
  })

  // Spoof Client Hints & Handle "Limit" status (Strip Cookies)
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let requestHeaders = details.requestHeaders
    
    // 1. Spoof User Agent
    requestHeaders['User-Agent'] = userAgent
    requestHeaders['sec-ch-ua'] = '"Chromium";v="146", "Not(A:Brand";v="99", "Google Chrome";v="146"'
    requestHeaders['sec-ch-ua-mobile'] = '?0'
    requestHeaders['sec-ch-ua-platform'] = '"Windows"'

    // 2. Handle "Limit" status - Prevent sending cookies
    try {
        const url = new URL(details.url)
        const hostname = url.hostname
        const limited = Object.entries(siteStatuses).find(([site, status]) => 
            status === 'limit' && (hostname === site || hostname.endsWith('.' + site))
        )
        
        if (limited) {
            console.log(`Stripping Cookie header for ${details.url} because ${limited[0]} is limited`)
            delete requestHeaders['Cookie']
        }
    } catch (e) {
        // Ignore
    }

    callback({ cancel: false, requestHeaders: requestHeaders })
  })

  // Handle "Limit" status - Prevent saving cookies (Set-Cookie)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let responseHeaders = details.responseHeaders
    
    try {
        const url = new URL(details.url)
        const hostname = url.hostname
        const limited = Object.entries(siteStatuses).find(([site, status]) => 
            status === 'limit' && (hostname === site || hostname.endsWith('.' + site))
        )
        
        if (limited && responseHeaders) {
            console.log(`Stripping Set-Cookie header for ${details.url} because ${limited[0]} is limited`)
            // Remove Set-Cookie header case-insensitively
            Object.keys(responseHeaders).forEach(key => {
                if (key.toLowerCase() === 'set-cookie') {
                    delete responseHeaders![key]
                }
            })
        }
    } catch (e) {
        // Ignore
    }

    callback({ cancel: false, responseHeaders: responseHeaders })
  })

  // Handle Downloads
  session.defaultSession.on('will-download', (_event, item, _webContents) => {
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

  // Load extensions
  const extensionDirs = fs.readdirSync(extensionsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(extensionsPath, dirent.name))

  for (const dir of extensionDirs) {
    try {
      const ext = await session.defaultSession.loadExtension(dir)
      console.log(`Loaded extension: ${ext.name}`)
    } catch (err) {
      console.error(`Failed to load extension from ${dir}:`, err)
    }
  }

  // Extensions Management IPC
  ipcMain.handle('get-extensions', () => {
    return session.defaultSession.getAllExtensions()
  })

  ipcMain.handle('load-unpacked-extension', async () => {
    const { filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    })
    
    if (filePaths.length > 0) {
        try {
            const ext = await session.defaultSession.loadExtension(filePaths[0])
            console.log(`Loaded unpacked extension: ${ext.name}`)
            return { success: true, extension: ext }
        } catch (e) {
            console.error('Failed to load extension', e)
            return { success: false, error: (e as Error).message }
        }
    }
    return { success: false, cancelled: true }
  })

  ipcMain.handle('remove-extension', (_event, extensionId: string) => {
    try {
        session.defaultSession.removeExtension(extensionId)
        return { success: true }
    } catch (e) {
        return { success: false, error: (e as Error).message }
    }
  })

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
