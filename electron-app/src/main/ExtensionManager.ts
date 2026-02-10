import { app, BrowserWindow, session, ipcMain, dialog, Menu, Notification } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import AdmZip from 'adm-zip'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TabInfo {
    id: string
    url: string
    title: string
    active: boolean
    windowId: number
    index: number
    favIconUrl?: string
    status: 'loading' | 'complete'
    incognito: boolean
}

interface ExtensionInfo {
    id: string
    name: string
    version: string
    path: string
    manifest: any
    description: string
    iconUrl: string
    popupPage: string | null
}

// ─── ExtensionManager ────────────────────────────────────────────────────────

export class ExtensionManager {
    private extensionsPath: string
    private tabRegistry: Map<string, TabInfo> = new Map()
    private activeTabId: string | null = null
    private mainWindow: BrowserWindow | null = null
    private popupWindow: BrowserWindow | null = null
    private extensionStorage: Map<string, Record<string, any>> = new Map()

    constructor() {
        this.extensionsPath = path.join(app.getPath('userData'), 'extensions')
        if (!fs.existsSync(this.extensionsPath)) {
            fs.mkdirSync(this.extensionsPath, { recursive: true })
        }
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    async initialize(mainWin: BrowserWindow): Promise<void> {
        this.mainWindow = mainWin
        await this.loadAllExtensions()
        this.registerIPCHandlers()
        this.setupPermissions()
        console.log('[ExtensionManager] Initialized')
    }

    // ─── Extension Lifecycle ─────────────────────────────────────────────────

    private async loadAllExtensions(): Promise<void> {
        if (!fs.existsSync(this.extensionsPath)) return

        const dirs = fs.readdirSync(this.extensionsPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name !== 'temp')
            .map(d => path.join(this.extensionsPath, d.name))

        for (const dir of dirs) {
            try {
                // Verify manifest exists before trying to load
                const manifestPath = path.join(dir, 'manifest.json')
                if (!fs.existsSync(manifestPath)) {
                    console.warn(`[ExtensionManager] Skipping ${dir} — no manifest.json`)
                    continue
                }
                // @ts-ignore — Electron 40 extensions API
                const ext = await session.defaultSession.extensions.loadExtension(dir)
                console.log(`[ExtensionManager] Loaded: ${ext.name} (${ext.id})`)
            } catch (err) {
                console.error(`[ExtensionManager] Failed to load ${dir}:`, err)
            }
        }
    }

    private getLoadedExtensions(): ExtensionInfo[] {
        // @ts-ignore
        const raw = session.defaultSession.extensions
            ? session.defaultSession.extensions.getAllExtensions()
            : session.defaultSession.getAllExtensions()

        // Deduplicate by extension ID (same extension can appear multiple times)
        const seen = new Set<string>()
        const unique = raw.filter((ext: any) => {
            if (seen.has(ext.id)) return false
            seen.add(ext.id)
            return true
        })

        return unique.map((ext: any) => {
            const manifest = ext.manifest || {}
            const iconUrl = this.resolveExtensionIcon(ext.path, manifest)
            const popupPage = this.resolvePopupPage(ext.id, manifest)

            return {
                id: ext.id,
                name: ext.name,
                version: manifest.version || '',
                path: ext.path,
                manifest,
                description: manifest.description || '',
                iconUrl,
                popupPage
            }
        })
    }

    private resolveExtensionIcon(extPath: string, manifest: any): string {
        if (!manifest.icons) return ''
        const sizes = Object.keys(manifest.icons).map(Number).sort((a, b) => b - a)
        if (sizes.length === 0) return ''

        const iconRelPath = manifest.icons[sizes[0].toString()]
        const cleanPath = iconRelPath.startsWith('/') ? iconRelPath.slice(1) : iconRelPath
        const fullPath = path.join(extPath, cleanPath)

        try {
            if (!fs.existsSync(fullPath)) return ''
            const buf = fs.readFileSync(fullPath)
            const ext = path.extname(iconRelPath).toLowerCase()
            const mime = ext === '.svg' ? 'image/svg+xml'
                : ext === '.webp' ? 'image/webp'
                    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                        : 'image/png'
            return `data:${mime};base64,${buf.toString('base64')}`
        } catch {
            return ''
        }
    }

    private resolvePopupPage(extId: string, manifest: any): string | null {
        const popup = manifest.action?.default_popup
            || manifest.browser_action?.default_popup
            || manifest.page_action?.default_popup
        if (!popup) return null
        const cleanPopup = popup.replace(/^\.?\//, '')
        return `chrome-extension://${extId}/${cleanPopup}`
    }

    // ─── Permissions ─────────────────────────────────────────────────────────

    private setupPermissions(): void {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            const url = webContents.getURL()
            // Auto-approve extension permission requests
            if (url.startsWith('chrome-extension://')) {
                callback(true)
                return
            }
            callback(false)
        })
    }

    // ─── Tab State Bridge ────────────────────────────────────────────────────

    updateTab(tabInfo: Partial<TabInfo> & { id: string }): void {
        const existing = this.tabRegistry.get(tabInfo.id)
        if (existing) {
            Object.assign(existing, tabInfo)
        } else {
            this.tabRegistry.set(tabInfo.id, {
                id: tabInfo.id,
                url: tabInfo.url || '',
                title: tabInfo.title || 'New Tab',
                active: tabInfo.active || false,
                windowId: 1,
                index: this.tabRegistry.size,
                favIconUrl: tabInfo.favIconUrl,
                status: tabInfo.status || 'complete',
                incognito: false
            })
        }

        // Keep active tab in sync
        if (tabInfo.active) {
            this.activeTabId = tabInfo.id
            // Mark all others as inactive
            this.tabRegistry.forEach((tab, id) => {
                if (id !== tabInfo.id) tab.active = false
            })
        }
    }

    removeTab(tabId: string): void {
        this.tabRegistry.delete(tabId)
        if (this.activeTabId === tabId) {
            const remaining = Array.from(this.tabRegistry.values())
            this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1].id : null
        }
        // Reindex
        let idx = 0
        this.tabRegistry.forEach(tab => { tab.index = idx++ })
    }

    setActiveTab(tabId: string): void {
        this.tabRegistry.forEach((tab, id) => {
            tab.active = id === tabId
        })
        this.activeTabId = tabId
    }

    // ─── Chrome API: tabs ────────────────────────────────────────────────────

    private tabsQuery(queryInfo: any): TabInfo[] {
        let results = Array.from(this.tabRegistry.values())

        if (queryInfo.active === true) {
            results = results.filter(t => t.active)
        }
        if (queryInfo.currentWindow === true || queryInfo.lastFocusedWindow === true) {
            // We only have one window, all tabs match
        }
        if (queryInfo.url) {
            const patterns = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url]
            results = results.filter(t => this.matchesUrlPattern(t.url, patterns))
        }
        if (queryInfo.title) {
            results = results.filter(t => t.title.includes(queryInfo.title))
        }

        return results
    }

    private tabsGet(tabId: string): TabInfo | undefined {
        return this.tabRegistry.get(tabId)
    }

    private tabsCreate(createProps: any): TabInfo {
        const id = Math.random().toString(36).substr(2, 9)
        const url = createProps.url || 'about:blank'

        // Send to renderer to actually create the tab
        this.mainWindow?.webContents.send('extension:create-tab', { url })

        const tab: TabInfo = {
            id,
            url,
            title: 'New Tab',
            active: createProps.active !== false,
            windowId: 1,
            index: this.tabRegistry.size,
            status: 'loading',
            incognito: false
        }
        this.tabRegistry.set(id, tab)
        return tab
    }

    private tabsUpdate(tabId: string, updateProps: any): TabInfo | undefined {
        const tab = this.tabRegistry.get(tabId)
        if (!tab) return undefined

        if (updateProps.url) {
            this.mainWindow?.webContents.send('extension:navigate-tab', { id: tabId, url: updateProps.url })
            tab.url = updateProps.url
        }
        if (updateProps.active) {
            this.mainWindow?.webContents.send('extension:activate-tab', { id: tabId })
            this.setActiveTab(tabId)
        }
        if (updateProps.pinned !== undefined) {
            this.mainWindow?.webContents.send('extension:pin-tab', { id: tabId, pinned: updateProps.pinned })
        }

        return tab
    }

    private tabsRemove(tabIds: string | string[]): void {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds]
        for (const id of ids) {
            this.mainWindow?.webContents.send('extension:close-tab', { id })
            this.removeTab(id)
        }
    }

    // ─── Chrome API: storage ─────────────────────────────────────────────────

    private getStoragePath(extensionId: string): string {
        return path.join(this.extensionsPath, extensionId, '_solarium_storage.json')
    }

    private loadStorage(extensionId: string): Record<string, any> {
        if (this.extensionStorage.has(extensionId)) {
            return this.extensionStorage.get(extensionId)!
        }
        const storagePath = this.getStoragePath(extensionId)
        try {
            if (fs.existsSync(storagePath)) {
                const data = JSON.parse(fs.readFileSync(storagePath, 'utf-8'))
                this.extensionStorage.set(extensionId, data)
                return data
            }
        } catch (e) {
            console.error(`[ExtensionManager] Failed to load storage for ${extensionId}:`, e)
        }
        this.extensionStorage.set(extensionId, {})
        return {}
    }

    private saveStorage(extensionId: string): void {
        const data = this.extensionStorage.get(extensionId) || {}
        const storagePath = this.getStoragePath(extensionId)
        try {
            fs.writeFileSync(storagePath, JSON.stringify(data, null, 2))
        } catch (e) {
            console.error(`[ExtensionManager] Failed to save storage for ${extensionId}:`, e)
        }
    }

    private storageGet(extensionId: string, keys: string | string[] | Record<string, any> | null): Record<string, any> {
        const storage = this.loadStorage(extensionId)

        if (keys === null || keys === undefined) {
            return { ...storage }
        }

        if (typeof keys === 'string') {
            return { [keys]: storage[keys] }
        }

        if (Array.isArray(keys)) {
            const result: Record<string, any> = {}
            for (const key of keys) {
                if (key in storage) result[key] = storage[key]
            }
            return result
        }

        // Object with defaults
        const result: Record<string, any> = {}
        for (const [key, defaultVal] of Object.entries(keys)) {
            result[key] = key in storage ? storage[key] : defaultVal
        }
        return result
    }

    private storageSet(extensionId: string, items: Record<string, any>): void {
        const storage = this.loadStorage(extensionId)
        Object.assign(storage, items)
        this.extensionStorage.set(extensionId, storage)
        this.saveStorage(extensionId)
    }

    private storageRemove(extensionId: string, keys: string | string[]): void {
        const storage = this.loadStorage(extensionId)
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const key of keyList) {
            delete storage[key]
        }
        this.extensionStorage.set(extensionId, storage)
        this.saveStorage(extensionId)
    }

    private storageClear(extensionId: string): void {
        this.extensionStorage.set(extensionId, {})
        this.saveStorage(extensionId)
    }

    // ─── Chrome API: browsingData ────────────────────────────────────────────

    private async clearBrowsingData(options: any, dataToRemove: any): Promise<void> {
        const ses = session.defaultSession

        try {
            if (dataToRemove.cache) {
                await ses.clearCache()
            }
            if (dataToRemove.cookies) {
                await ses.clearStorageData({ storages: ['cookies'] })
            }
            if (dataToRemove.localStorage) {
                await ses.clearStorageData({ storages: ['localstorage'] })
            }
            if (dataToRemove.history || dataToRemove.downloads) {
                // Electron doesn't manage history/downloads in session, signal renderer
                this.mainWindow?.webContents.send('extension:clear-browsing-data', dataToRemove)
            }
            if (dataToRemove.formData) {
                await ses.clearStorageData({ storages: ['localstorage'] })
            }
            if (dataToRemove.indexedDB) {
                await ses.clearStorageData({ storages: ['indexdb'] })
            }
            if (dataToRemove.serviceWorkers) {
                await ses.clearStorageData({ storages: ['serviceworkers'] })
            }

            console.log('[ExtensionManager] Cleared browsing data:', Object.keys(dataToRemove).filter(k => dataToRemove[k]))
        } catch (e) {
            console.error('[ExtensionManager] Failed to clear browsing data:', e)
        }
    }

    // ─── Chrome API: notifications ───────────────────────────────────────────

    private showNotification(extId: string, notifId: string, options: any): string {
        const notif = new Notification({
            title: options.title || '',
            body: options.message || '',
            icon: options.iconUrl || undefined
        })
        notif.show()
        return notifId || Math.random().toString(36).substr(2, 9)
    }

    // ─── Content Script Injection ────────────────────────────────────────────

    getContentScriptsForUrl(url: string): Array<{ extensionId: string; js: string[]; css: string[]; runAt: string }> {
        const extensions = this.getLoadedExtensions()
        const results: Array<{ extensionId: string; js: string[]; css: string[]; runAt: string }> = []

        for (const ext of extensions) {
            const contentScripts = ext.manifest.content_scripts || []
            for (const cs of contentScripts) {
                const matches = cs.matches || []
                const excludeMatches = cs.exclude_matches || []

                if (this.matchesUrlPattern(url, matches) && !this.matchesUrlPattern(url, excludeMatches)) {
                    const jsFiles: string[] = []
                    const cssFiles: string[] = []

                    for (const jsFile of (cs.js || [])) {
                        const fullPath = path.join(ext.path, jsFile)
                        try {
                            if (fs.existsSync(fullPath)) {
                                jsFiles.push(fs.readFileSync(fullPath, 'utf-8'))
                            }
                        } catch (e) {
                            console.error(`[ExtensionManager] Failed to read content script ${jsFile}:`, e)
                        }
                    }

                    for (const cssFile of (cs.css || [])) {
                        const fullPath = path.join(ext.path, cssFile)
                        try {
                            if (fs.existsSync(fullPath)) {
                                cssFiles.push(fs.readFileSync(fullPath, 'utf-8'))
                            }
                        } catch (e) {
                            console.error(`[ExtensionManager] Failed to read content CSS ${cssFile}:`, e)
                        }
                    }

                    if (jsFiles.length > 0 || cssFiles.length > 0) {
                        results.push({
                            extensionId: ext.id,
                            js: jsFiles,
                            css: cssFiles,
                            runAt: cs.run_at || 'document_idle'
                        })
                    }
                }
            }
        }

        return results
    }

    // ─── URL Pattern Matching ────────────────────────────────────────────────

    private matchesUrlPattern(url: string, patterns: string[]): boolean {
        for (const pattern of patterns) {
            if (pattern === '<all_urls>') return true

            try {
                // Chrome extension match pattern: scheme://host/path
                const match = pattern.match(/^(\*|https?|ftp|file):\/\/(\*|(?:\*\.)?[^/]*)\/(.*)$/)
                if (!match) continue

                const [, scheme, host, patternPath] = match
                const parsed = new URL(url)

                // Check scheme
                if (scheme !== '*' && scheme !== parsed.protocol.replace(':', '')) continue

                // Check host
                if (host !== '*') {
                    if (host.startsWith('*.')) {
                        const domain = host.slice(2)
                        if (parsed.hostname !== domain && !parsed.hostname.endsWith('.' + domain)) continue
                    } else {
                        if (parsed.hostname !== host) continue
                    }
                }

                // Check path
                const pathRegex = new RegExp('^/' + patternPath.replace(/\*/g, '.*') + '$')
                if (!pathRegex.test(parsed.pathname + parsed.search)) continue

                return true
            } catch {
                continue
            }
        }
        return false
    }

    // ─── Popup Manager ───────────────────────────────────────────────────────

    private getPreloadPath(): string {
        return path.join(this.extensionsPath, 'popup-preload.js')
    }

    private createPreloadScript(activeTab: any): void {
        // Build the real tab data from the registry instead of relying on stale info
        let tabData: TabInfo | undefined
        if (activeTab?.id) {
            tabData = this.tabRegistry.get(activeTab.id)
        }
        if (!tabData && this.activeTabId) {
            tabData = this.tabRegistry.get(this.activeTabId)
        }

        const safeUrl = (tabData?.url || activeTab?.url || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
        const safeTitle = (tabData?.title || activeTab?.title || 'Tab').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

        // Serialize the full tab list for chrome.tabs.query
        const allTabs = Array.from(this.tabRegistry.values())
        const tabsJson = JSON.stringify(allTabs).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

        const polyfill = `
        (function() {
            try {
                if (!window.chrome) window.chrome = {};

                // ── chrome.tabs ──
                if (!window.chrome.tabs) window.chrome.tabs = {};

                const ALL_TABS = JSON.parse('${tabsJson}');
                const activeTabData = {
                    id: 1,
                    index: 0,
                    windowId: 1,
                    highlighted: true,
                    active: true,
                    selected: true,
                    status: 'complete',
                    url: "${safeUrl}",
                    title: "${safeTitle}",
                    incognito: false,
                    width: 1200,
                    height: 800
                };

                // Use real tab data if available, fall back to mock
                const tabsList = ALL_TABS.length > 0 ? ALL_TABS : [activeTabData];

                const promisify = (fn) => function(...args) {
                    const last = args[args.length - 1];
                    if (typeof last === 'function') return fn(...args);
                    return new Promise(resolve => fn(...args, resolve));
                };

                const origQuery = window.chrome.tabs.query;
                window.chrome.tabs.query = promisify(function(q, cb) {
                    let results = [...tabsList];
                    if (q && q.active) results = results.filter(t => t.active);
                    if (q && q.url) {
                        const patterns = Array.isArray(q.url) ? q.url : [q.url];
                        results = results.filter(t => patterns.some(p => {
                            if (p === '<all_urls>') return true;
                            try { return new RegExp('^' + p.replace(/\\*/g, '.*') + '$').test(t.url); }
                            catch { return false; }
                        }));
                    }
                    if (origQuery && typeof origQuery === 'function') {
                        try { origQuery(q, cb); return; } catch {}
                    }
                    cb(results);
                });

                if (!window.chrome.tabs.get) {
                    window.chrome.tabs.get = promisify((tabId, cb) => {
                        const found = tabsList.find(t => t.id == tabId);
                        cb(found || activeTabData);
                    });
                }

                if (!window.chrome.tabs.create) {
                    window.chrome.tabs.create = promisify((props, cb) => {
                        window.open(props.url || 'about:blank', '_blank');
                        if (cb) cb(activeTabData);
                    });
                }

                if (!window.chrome.tabs.update) {
                    window.chrome.tabs.update = promisify((tabId, props, cb) => {
                        if (props.url) window.open(props.url, '_blank');
                        if (cb) cb(activeTabData);
                    });
                }

                if (!window.chrome.tabs.remove) {
                    window.chrome.tabs.remove = promisify((tabIds, cb) => {
                        console.log('[Polyfill] chrome.tabs.remove:', tabIds);
                        if (cb) cb();
                    });
                }

                if (!window.chrome.tabs.sendMessage) {
                    window.chrome.tabs.sendMessage = promisify((tabId, msg, opts, cb) => {
                        if (typeof opts === 'function') { cb = opts; }
                        console.log('[Polyfill] chrome.tabs.sendMessage:', msg);
                        if (cb) cb(undefined);
                    });
                }

                if (!window.chrome.tabs.executeScript) {
                    window.chrome.tabs.executeScript = promisify((tabId, details, cb) => {
                        console.log('[Polyfill] chrome.tabs.executeScript stub');
                        if (cb) cb([]);
                    });
                }

                // ── chrome.storage ──
                if (!window.chrome.storage) {
                    const { ipcRenderer } = require('electron');
                    const getExtId = () => {
                         try { return window.location.host; } catch { return ''; }
                    };
                    
                    const createStorageArea = (areaName) => ({
                        get: promisify((keys, cb) => {
                             ipcRenderer.invoke('extension:storage-get', getExtId(), keys).then(res => cb(res)).catch(() => cb({}));
                        }),
                        set: promisify((items, cb) => {
                             ipcRenderer.invoke('extension:storage-set', getExtId(), items).then(() => cb && cb());
                        }),
                        remove: promisify((keys, cb) => {
                             ipcRenderer.invoke('extension:storage-remove', getExtId(), keys).then(() => cb && cb());
                        }),
                        clear: promisify((cb) => {
                             ipcRenderer.invoke('extension:storage-clear', getExtId()).then(() => cb && cb());
                        })
                    });

                    window.chrome.storage = {
                        local: createStorageArea('local'),
                        sync: createStorageArea('sync'), // mapped to local for now
                        managed: createStorageArea('managed'),
                        onChanged: { addListener: () => {} }
                    };
                }

                // ── chrome.windows ──
                if (!window.chrome.windows) window.chrome.windows = {};
                if (!window.chrome.windows.getCurrent) {
                    window.chrome.windows.getCurrent = promisify((opts, cb) => {
                        if (typeof opts === 'function') { cb = opts; }
                        cb({ id: 1, focused: true, type: 'normal', state: 'maximized',
                             width: 1920, height: 1080, top: 0, left: 0 });
                    });
                }
                if (!window.chrome.windows.getAll) {
                    window.chrome.windows.getAll = promisify((opts, cb) => {
                        if (typeof opts === 'function') { cb = opts; }
                        cb([{ id: 1, focused: true, type: 'normal', state: 'maximized' }]);
                    });
                }
                window.chrome.windows.WINDOW_ID_CURRENT = -2;
                window.chrome.windows.WINDOW_ID_NONE = -1;

                // ── chrome.browsingData ──
                if (!window.chrome.browsingData) {
                    window.chrome.browsingData = {};
                    const methods = ['remove','removeCache','removeCookies','removeDownloads',
                        'removeFormData','removeHistory','removeLocalStorage','removePasswords','removePluginData'];
                    methods.forEach(m => {
                        window.chrome.browsingData[m] = promisify(function(...args) {
                            const cb = args[args.length - 1];
                            console.log('[Polyfill] chrome.browsingData.' + m + ' called');
                            // Signal main process
                            if (window.chrome.runtime && window.chrome.runtime.sendMessage) {
                                try { window.chrome.runtime.sendMessage({ _solarium_browsingData: m, args: args.slice(0, -1) }); } catch {}
                            }
                            if (typeof cb === 'function') cb();
                        });
                    });
                }

                // ── chrome.notifications ──
                if (!window.chrome.notifications) {
                    window.chrome.notifications = {};
                    window.chrome.notifications.create = promisify((id, opts, cb) => {
                        if (typeof opts === 'function') { cb = opts; opts = id; id = null; }
                        if (Notification.permission === 'granted' || Notification.permission === 'default') {
                            new Notification(opts.title || '', { body: opts.message || '' });
                        }
                        if (cb) cb(id || 'notif_' + Date.now());
                    });
                    window.chrome.notifications.clear = promisify((id, cb) => { if (cb) cb(true); });
                }

                // ── chrome.i18n (stub) ──
                if (!window.chrome.i18n) {
                    window.chrome.i18n = {};
                    window.chrome.i18n.getMessage = (key, ...args) => key;
                    window.chrome.i18n.getUILanguage = () => navigator.language || 'en';
                }

                // ── chrome.management (stub) ──
                if (!window.chrome.management) {
                    window.chrome.management = {};
                    window.chrome.management.getSelf = promisify((cb) => {
                        cb({ installType: 'development', enabled: true });
                    });
                }

                console.log('[Polyfill] Chrome API polyfills injected. Tabs:', tabsList.length);
            } catch (e) {
                console.error('[Polyfill] Error:', e);
            }
        })();
        `

        fs.writeFileSync(this.getPreloadPath(), polyfill)
    }

    openPopup(popupPage: string, activeTab: any): void {
        // Close existing popup
        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.close()
        }

        // Generate preload script with current tab state
        this.createPreloadScript(activeTab)

        this.popupWindow = new BrowserWindow({
            width: 400,
            height: 550,
            frame: false,
            resizable: true,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: false, // Must be false for chrome.* injection to work on window
                sandbox: false,
                webSecurity: false,
                session: session.defaultSession,
                backgroundThrottling: false,
                preload: this.getPreloadPath() // Use the generated preload script
            }
        })

        const win = this.popupWindow

        // Log popup console messages for debugging
        win.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
            console.log(`[ExtPopup] ${message} (${sourceId}:${line})`)
        })

        // Handle navigation requests from the popup (e.g. links)
        win.webContents.setWindowOpenHandler(({ url }) => {
            // Open external links in the main browser
            if (url.startsWith('http')) {
                this.mainWindow?.webContents.send('create-tab', url)
                return { action: 'deny' }
            }
            return { action: 'allow' }
        })

        win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
            console.error(`[ExtPopup] Failed to load: ${errorCode} ${errorDescription} URL: ${validatedURL}`)
        })

        win.loadURL(popupPage).catch(e => {
            console.error('[ExtPopup] Failed to load popup URL:', e)
        })

        win.once('ready-to-show', () => {
            // Position popup near cursor
            const { screen } = require('electron')
            const point = screen.getCursorScreenPoint()
            const display = screen.getDisplayNearestPoint(point)
            let x = point.x - 300
            let y = point.y + 20
            if (x < display.bounds.x) x = display.bounds.x
            if (x + 400 > display.bounds.x + display.bounds.width) x = display.bounds.x + display.bounds.width - 400
            if (y + 550 > display.bounds.y + display.bounds.height) y = point.y - 570
            win.setPosition(x, y)
            win.show()
        })

        // Close popup when it loses focus
        win.on('blur', () => {
            if (!win.isDestroyed()) {
                win.close()
            }
        })

        // Right-click inspect for debugging
        win.webContents.on('context-menu', (_event, params) => {
            const menu = Menu.buildFromTemplate([
                { label: 'Inspect Element', click: () => win.webContents.inspectElement(params.x, params.y) },
                { label: 'Open DevTools', click: () => win.webContents.openDevTools({ mode: 'detach' }) },
                { label: 'Reload', click: () => win.webContents.reload() }
            ])
            menu.popup()
        })
    }

    // ─── CRX Installer ──────────────────────────────────────────────────────

    setupCRXHandler(): void {
        session.defaultSession.on('will-download', (_event, item, _webContents) => {
            const url = item.getURL()
            const filename = item.getFilename()

            // Only handle CRX downloads
            if (!filename.endsWith('.crx') && !url.includes('response=redirect')) return

            const extId = filename.replace('.crx', '') || 'unknown'
            const tempDir = path.join(this.extensionsPath, 'temp')
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

            const tempPath = path.join(tempDir, `${extId}.crx`)
            const destDir = path.join(this.extensionsPath, extId)

            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

            item.setSavePath(tempPath)

            item.once('done', async (_event, state) => {
                if (state === 'completed') {
                    console.log(`[ExtensionManager] CRX download completed, installing to ${destDir}`)
                    try {
                        const fileBuf = fs.readFileSync(tempPath)
                        let zipBuf = fileBuf

                        // CRX files have a header before the ZIP data
                        const zipStart = fileBuf.indexOf(Buffer.from([0x50, 0x4B, 0x03, 0x04]))
                        if (zipStart > 0) {
                            zipBuf = fileBuf.subarray(zipStart)
                        }

                        const zip = new AdmZip(zipBuf)
                        zip.extractAllTo(destDir, true)

                        // @ts-ignore
                        const ext = await session.defaultSession.extensions.loadExtension(destDir)
                        console.log(`[ExtensionManager] Installed: ${ext.name}`)

                        // Notify renderer
                        BrowserWindow.getAllWindows().forEach(win => {
                            win.webContents.send('extension-installed', ext.name)
                        })

                        // Cleanup
                        fs.unlinkSync(tempPath)
                    } catch (e) {
                        console.error('[ExtensionManager] Failed to install CRX:', e)
                    }
                } else {
                    console.log(`[ExtensionManager] CRX download failed: ${state}`)
                }
            })
        })
    }

    // ─── IPC Registration ───────────────────────────────────────────────────

    private registerIPCHandlers(): void {
        // Extension lifecycle
        ipcMain.handle('extension:get-all', () => {
            return this.getLoadedExtensions()
        })

        ipcMain.handle('extension:load-unpacked', async () => {
            const { filePaths } = await dialog.showOpenDialog({
                properties: ['openDirectory']
            })
            if (filePaths.length > 0) {
                try {
                    // @ts-ignore
                    const ext = await session.defaultSession.extensions.loadExtension(filePaths[0])
                    console.log(`[ExtensionManager] Loaded unpacked: ${ext.name}`)
                    return { success: true, extension: ext }
                } catch (e) {
                    console.error('[ExtensionManager] Failed to load unpacked:', e)
                    return { success: false, error: (e as Error).message }
                }
            }
            return { success: false, cancelled: true }
        })

        ipcMain.handle('extension:remove', (_event, extensionId: string) => {
            try {
                // @ts-ignore
                session.defaultSession.extensions.removeExtension(extensionId)

                // Clean up storage
                this.extensionStorage.delete(extensionId)
                const storagePath = this.getStoragePath(extensionId)
                if (fs.existsSync(storagePath)) {
                    fs.unlinkSync(storagePath)
                }

                return { success: true }
            } catch (e) {
                return { success: false, error: (e as Error).message }
            }
        })

        // Popup
        ipcMain.handle('extension:open-popup', (_event, arg) => {
            const popupPage = typeof arg === 'string' ? arg : arg.popupPage
            const activeTab = typeof arg === 'object' ? arg.activeTab : null
            if (popupPage) {
                this.openPopup(popupPage, activeTab)
            }
        })

        // Open devtools for an extension's background page
        ipcMain.handle('open-extension-devtools', (_event, extensionId: string) => {
            const allWC = require('electron').webContents.getAllWebContents()
            const extWC = allWC.find((wc: any) =>
                wc.getURL().includes(extensionId) && wc.getType() === 'backgroundPage'
            )
            if (extWC) {
                extWC.openDevTools({ mode: 'detach' })
            } else {
                console.log(`[ExtensionManager] No background page found for ${extensionId}`)
            }
        })

        // Tab state bridge from renderer
        ipcMain.on('extension:tab-updated', (_event, tabInfo) => {
            this.updateTab(tabInfo)
        })

        ipcMain.on('extension:tab-created', (_event, tabInfo) => {
            this.updateTab({ ...tabInfo, status: 'loading' })
        })

        ipcMain.on('extension:tab-removed', (_event, { id }) => {
            this.removeTab(id)
        })

        ipcMain.on('extension:tab-activated', (_event, { id }) => {
            this.setActiveTab(id)
        })

        // Content script injection request from renderer
        ipcMain.handle('extension:get-content-scripts', (_event, url: string) => {
            return this.getContentScriptsForUrl(url)
        })

        // Storage API
        ipcMain.handle('extension:storage-get', (_event, extensionId: string, keys: any) => {
            return this.storageGet(extensionId, keys)
        })

        ipcMain.handle('extension:storage-set', (_event, extensionId: string, items: Record<string, any>) => {
            this.storageSet(extensionId, items)
        })

        ipcMain.handle('extension:storage-remove', (_event, extensionId: string, keys: string | string[]) => {
            this.storageRemove(extensionId, keys)
        })

        ipcMain.handle('extension:storage-clear', (_event, extensionId: string) => {
            this.storageClear(extensionId)
        })

        // Browsing data API
        ipcMain.handle('extension:clear-browsing-data', async (_event, options: any, dataToRemove: any) => {
            await this.clearBrowsingData(options, dataToRemove)
        })

        // Notifications
        ipcMain.handle('extension:notification-create', (_event, extId: string, notifId: string, options: any) => {
            return this.showNotification(extId, notifId, options)
        })

        // Keep legacy handlers as aliases for backward compat during transition
        ipcMain.handle('get-extensions', () => this.getLoadedExtensions())
        ipcMain.handle('open-extension-popup', (_event, arg) => {
            const popupPage = typeof arg === 'string' ? arg : arg.popupPage
            const activeTab = typeof arg === 'object' ? arg.activeTab : null
            if (popupPage) this.openPopup(popupPage, activeTab)
        })
        ipcMain.handle('load-unpacked-extension', async () => {
            const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
            if (filePaths.length > 0) {
                try {
                    // @ts-ignore
                    const ext = await session.defaultSession.extensions.loadExtension(filePaths[0])
                    return { success: true, extension: ext }
                } catch (e) {
                    return { success: false, error: (e as Error).message }
                }
            }
            return { success: false, cancelled: true }
        })
        ipcMain.handle('remove-extension', (_event, extensionId: string) => {
            try {
                // @ts-ignore
                session.defaultSession.extensions.removeExtension(extensionId)
                return { success: true }
            } catch (e) {
                return { success: false, error: (e as Error).message }
            }
        })
    }
}
