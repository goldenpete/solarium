import { useState, useEffect, useRef } from 'react'
import { ipcRenderer, clipboard } from 'electron'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, getFaviconUrl } from '@/lib/utils'

interface Tab {
  id: string
  url: string
  initialUrl?: string // Stable URL for webview src
  title: string
  favicon?: string
  type: 'favorite' | 'pinned' | 'standard'
  workspaceId: string
}

interface Workspace {
  id: string
  name: string
  color: string
  icon: string
}

function App() {
  // Persistence Helpers
  const getStoredState = <T,>(key: string, fallback: T): T => {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : fallback
    } catch (e) {
      console.error(`Failed to load ${key}`, e)
      return fallback
    }
  }

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => getStoredState('savedWorkspaces', [
    { id: '1', name: 'Space 1', color: 'bg-blue-500', icon: 'ri-home-line' },
    { id: '2', name: 'Space 2', color: 'bg-rose-500', icon: 'ri-briefcase-line' },
    { id: '3', name: 'Space 3', color: 'bg-emerald-500', icon: 'ri-gamepad-line' }
  ]))

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => {
    return localStorage.getItem('savedActiveWorkspaceId') || '1'
  })

  const [tabs, setTabs] = useState<Tab[]>(() => {
    const stored = getStoredState<Tab[]>('savedTabs', [
      { id: '1', url: 'https://google.com', title: 'New Tab', favicon: getFaviconUrl('https://google.com'), type: 'standard', workspaceId: '1' }
    ])
    // Backfill initialUrl for restored tabs to prevent reload loops
    return stored.map(t => ({
      ...t,
      initialUrl: t.initialUrl || t.url
    }))
  })

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return localStorage.getItem('savedActiveTabId') || '1'
  })

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem('savedWorkspaces', JSON.stringify(workspaces))
  }, [workspaces])

  useEffect(() => {
    localStorage.setItem('savedActiveWorkspaceId', activeWorkspaceId)
  }, [activeWorkspaceId])

  useEffect(() => {
    localStorage.setItem('savedTabs', JSON.stringify(tabs))
  }, [tabs])

  useEffect(() => {
    localStorage.setItem('savedActiveTabId', activeTabId)
  }, [activeTabId])

  // State Validation (ensure valid active tab)
  useEffect(() => {
    if (tabs.length > 0 && !tabs.find(t => t.id === activeTabId)) {
      setActiveTabId(tabs[0].id)
    }
  }, [tabs.length]) // Only check when tab count changes (initially or after bulk updates)

  const [urlInput, setUrlInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [defaultSearchEngine, setDefaultSearchEngine] = useState(() => localStorage.getItem('defaultSearchEngine') || 'google')
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [editPosition, setEditPosition] = useState<{ x: number, y: number } | null>(null)
  const [showSecurityPopover, setShowSecurityPopover] = useState(false)
  const [extensionsList, setExtensionsList] = useState<any[]>([])
  const [trackingProtection, setTrackingProtection] = useState(() => localStorage.getItem('trackingProtection') !== 'false')
  const [blockedCount, setBlockedCount] = useState(0)
  const webviewRefs = useRef<{ [key: string]: Electron.WebviewTag }>({})

  // Sync Search Engine from Settings Window
  useEffect(() => {
    const handleSearchEngineUpdate = (_event: any, engine: string) => {
      setDefaultSearchEngine(engine)
    }
    ipcRenderer.on('search-engine-updated', handleSearchEngineUpdate)
    return () => {
      ipcRenderer.removeListener('search-engine-updated', handleSearchEngineUpdate)
    }
  }, [])

  // Sync Tracking Protection with Main Process
  useEffect(() => {
    localStorage.setItem('trackingProtection', String(trackingProtection))
    ipcRenderer.invoke('set-tracking-protection', trackingProtection)
  }, [trackingProtection])

  // Listen for blocked trackers
  useEffect(() => {
    // Get initial count
    ipcRenderer.invoke('get-blocked-count').then(setBlockedCount).catch(console.error)

    const handleBlocked = (_event: any, _url: string) => {
      setBlockedCount(prev => prev + 1)
    }

    ipcRenderer.on('tracker-blocked', handleBlocked)
    return () => {
      ipcRenderer.removeListener('tracker-blocked', handleBlocked)
    }
  }, [])

  // Listen for extension installed events from main process (e.g. CRX downloads)
  useEffect(() => {
    const handleExtensionInstalled = () => {
      ipcRenderer.invoke('extension:get-all').then(setExtensionsList).catch(console.error)
    }
    ipcRenderer.on('extension-installed', handleExtensionInstalled)
    return () => {
      ipcRenderer.removeListener('extension-installed', handleExtensionInstalled)
    }
  }, [])

  useEffect(() => {
    if (showSecurityPopover) {
      ipcRenderer.invoke('extension:get-all').then(setExtensionsList).catch(console.error)
      // Also refresh blocked count when popover opens
      ipcRenderer.invoke('get-blocked-count').then(setBlockedCount).catch(console.error)
    }
  }, [showSecurityPopover])

  // Sync active tab changes to ExtensionManager
  useEffect(() => {
    if (activeTabId) {
      ipcRenderer.send('extension:tab-activated', { id: activeTabId })
    }
  }, [activeTabId])

  // Listen for extension commands from ExtensionManager
  useEffect(() => {
    const handleExtCreateTab = (_event: any, data: any) => createTab(data.url || 'https://google.com')
    const handleExtNavigateTab = (_event: any, data: any) => {
      const ref = webviewRefs.current[data.id]
      if (ref && data.url) ref.loadURL(data.url)
    }
    const handleExtCloseTab = (_event: any, data: any) => {
      setTabs(prev => {
        const newTabs = prev.filter(t => t.id !== data.id)
        return newTabs.length === 0 ? prev : newTabs
      })
    }
    const handleExtActivateTab = (_event: any, data: any) => setActiveTabId(data.id)

    ipcRenderer.on('extension:create-tab', handleExtCreateTab)
    ipcRenderer.on('extension:navigate-tab', handleExtNavigateTab)
    ipcRenderer.on('extension:close-tab', handleExtCloseTab)
    ipcRenderer.on('extension:activate-tab', handleExtActivateTab)

    return () => {
      ipcRenderer.removeListener('extension:create-tab', handleExtCreateTab)
      ipcRenderer.removeListener('extension:navigate-tab', handleExtNavigateTab)
      ipcRenderer.removeListener('extension:close-tab', handleExtCloseTab)
      ipcRenderer.removeListener('extension:activate-tab', handleExtActivateTab)
    }
  }, [activeWorkspaceId])

  const toggleFavorite = () => {
    if (!activeTab) return
    const newType = activeTab.type === 'favorite' ? 'standard' : 'favorite'
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, type: newType } : t))
  }

  const handleScreenshot = async () => {
    const webview = webviewRefs.current[activeTabId]
    if (webview) {
      try {
        const image = await webview.capturePage()
        clipboard.writeImage(image)
        setShowSecurityPopover(false)
      } catch (e) {
        console.error('Screenshot failed', e)
      }
    }
  }

  const copyUrl = () => {
    if (activeTab?.url) {
      clipboard.writeText(activeTab.url)
      setShowSecurityPopover(false)
    }
  }

  const WORKSPACE_COLORS = [
    'bg-blue-500',
    'bg-rose-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-violet-500',
    'bg-cyan-500',
    'bg-fuchsia-500',
    'bg-lime-500'
  ]

  const activeTab = tabs.find(t => t.id === activeTabId)

  // Update URL input when switching tabs
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url)
    }
  }, [activeTabId, tabs])

  // Handle context menu commands from main process
  useEffect(() => {
    // Sync site statuses on startup
    const storedStatuses = localStorage.getItem('siteStatuses')
    if (storedStatuses) {
      try {
        const parsed = JSON.parse(storedStatuses)
        Object.entries(parsed).forEach(([site, status]) => {
          ipcRenderer.invoke('update-site-status', site, status)
        })
      } catch (e) {
        console.error('Failed to sync site statuses', e)
      }
    }

    const handleCommand = (_event: any, command: string, ...args: any[]) => {
      const webview = webviewRefs.current[activeTabId]
      if (!webview) return

      switch (command) {
        case 'goBack':
          if (webview.canGoBack()) webview.goBack()
          break
        case 'goForward':
          if (webview.canGoForward()) webview.goForward()
          break
        case 'reload':
          webview.reload()
          break
        case 'openLinkInNewTab':
          const [url] = args
          const newId = Math.random().toString(36).substr(2, 9)
          const newTab: Tab = {
            id: newId,
            url,
            initialUrl: url,
            title: 'New Tab',
            type: 'standard',
            workspaceId: activeWorkspaceId
          }
          setTabs(prev => [...prev, newTab])
          setActiveTabId(newId)
          break
        case 'searchGoogle':
          const [text] = args
          const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(text)
          const searchId = Math.random().toString(36).substr(2, 9)
          const searchTab: Tab = {
            id: searchId,
            url: searchUrl,
            initialUrl: searchUrl,
            title: 'New Tab',
            type: 'standard',
            workspaceId: activeWorkspaceId
          }
          setTabs(prev => [...prev, searchTab])
          setActiveTabId(searchId)
          break
        case 'inspectElement':
          const [{ x, y }] = args
          webview.inspectElement(x, y)
          break
      }
    }

    ipcRenderer.on('context-menu-command', handleCommand)
    return () => {
      ipcRenderer.removeListener('context-menu-command', handleCommand)
    }
  }, [activeTabId])

  // Handle tab context menu commands
  useEffect(() => {
    const handleTabCommand = (_event: any, command: string, tabId: string) => {
      switch (command) {
        case 'newTab':
          createTab()
          break
        case 'reload':
          if (webviewRefs.current[tabId]) {
            webviewRefs.current[tabId].reload()
          }
          break
        case 'duplicate':
          const tabToDuplicate = tabs.find(t => t.id === tabId)
          if (tabToDuplicate) {
            const newId = Math.random().toString(36).substr(2, 9)
            const newTab: Tab = {
              id: newId,
              url: tabToDuplicate.url,
              initialUrl: tabToDuplicate.url,
              title: tabToDuplicate.title,
              type: 'standard',
              workspaceId: activeWorkspaceId
            }
            setTabs(prev => [...prev, newTab])
            setActiveTabId(newId)
          }
          break
        case 'close':
          // We need to simulate the event object or create a separate close function that doesn't need it
          // Re-using logic from closeTab but without the event
          const newTabs = tabs.filter(t => t.id !== tabId)
          if (newTabs.length === 0) {
            createTab()
          } else {
            setTabs(newTabs)
            if (activeTabId === tabId) {
              setActiveTabId(newTabs[newTabs.length - 1].id)
            }
          }
          break
        case 'closeOthers':
          const keptTab = tabs.find(t => t.id === tabId)
          if (keptTab) {
            setTabs([keptTab])
            setActiveTabId(tabId)
          }
          break
        case 'closeRight':
          const index = tabs.findIndex(t => t.id === tabId)
          if (index !== -1) {
            const newTabsList = tabs.slice(0, index + 1)
            setTabs(newTabsList)
            // If active tab was closed (it was to the right), switch to the last remaining tab
            if (!newTabsList.find(t => t.id === activeTabId)) {
              setActiveTabId(tabId)
            }
          }
          break
        case 'togglePin':
          setTabs(prev => prev.map(t => {
            if (t.id === tabId) {
              return { ...t, type: t.type === 'pinned' ? 'standard' : 'pinned' }
            }
            return t
          }))
          break
        case 'toggleFavorite':
          setTabs(prev => prev.map(t => {
            if (t.id === tabId) {
              return { ...t, type: t.type === 'favorite' ? 'standard' : 'favorite' }
            }
            return t
          }))
          break
      }
    }

    ipcRenderer.on('tab-context-menu-command', handleTabCommand)
    return () => {
      ipcRenderer.removeListener('tab-context-menu-command', handleTabCommand)
    }
  }, [tabs, activeTabId])

  const createTab = (urlOrEvent?: string | React.MouseEvent) => {
    const url = typeof urlOrEvent === 'string' ? urlOrEvent : 'https://google.com'
    const newId = Math.random().toString(36).substr(2, 9)

    setTabs(prevTabs => {
      const newTab: Tab = {
        id: newId,
        url: url,
        initialUrl: url,
        title: 'New Tab',
        favicon: url !== 'https://google.com' ? getFaviconUrl(url) : undefined,
        type: 'standard',
        workspaceId: activeWorkspaceId
      }
      return [...prevTabs, newTab]
    })
    setActiveTabId(newId)

    // Sync to ExtensionManager
    ipcRenderer.send('extension:tab-created', { id: newId, url, title: 'New Tab', active: true, workspaceId: activeWorkspaceId })
  }

  // Listen for create-tab requests from main process
  useEffect(() => {
    const handleCreateTab = (_event: any, url: string) => {
      createTab(url)
    }
    ipcRenderer.on('create-tab', handleCreateTab)
    return () => {
      ipcRenderer.removeListener('create-tab', handleCreateTab)
    }
  }, [activeWorkspaceId]) // Re-bind when workspace changes to ensure correct ID

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    // Sync to ExtensionManager
    ipcRenderer.send('extension:tab-removed', { id })
    delete webviewRefs.current[id]

    const newTabs = tabs.filter(t => t.id !== id)
    if (newTabs.length === 0) {
      createTab() // Always keep one tab open
    } else {
      setTabs(newTabs)
      if (activeTabId === id) {
        setActiveTabId(newTabs[newTabs.length - 1].id)
      }
    }
  }

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    let url = urlInput
    if (!url.startsWith('http')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url
      } else {
        const searchUrls: { [key: string]: string } = {
          google: 'https://www.google.com/search?q=',
          bing: 'https://www.bing.com/search?q=',
          duckduckgo: 'https://duckduckgo.com/?q=',
          yahoo: 'https://search.yahoo.com/search?p='
        }
        url = (searchUrls[defaultSearchEngine] || searchUrls['google']) + encodeURIComponent(url)
      }
    }

    // Navigate via ref instead of updating state to prevent reload loops
    if (activeTabId && webviewRefs.current[activeTabId]) {
      webviewRefs.current[activeTabId].loadURL(url)
    }
  }

  const goBack = () => {
    if (activeTabId && webviewRefs.current[activeTabId]) {
      webviewRefs.current[activeTabId].goBack()
    }
  }

  const goForward = () => {
    if (activeTabId && webviewRefs.current[activeTabId]) {
      webviewRefs.current[activeTabId].goForward()
    }
  }

  const reload = () => {
    if (activeTabId && webviewRefs.current[activeTabId]) {
      webviewRefs.current[activeTabId].reload()
    }
  }

  const updateTabInfo = (id: string, title: string, url: string) => {
    setTabs(prev => prev.map(t =>
      t.id === id ? { ...t, title, url } : t
    ))
    if (id === activeTabId) {
      setUrlInput(url)
    }

    // Sync to ExtensionManager
    ipcRenderer.send('extension:tab-updated', { id, url, title, active: id === activeTabId, status: 'complete' })
  }

  const updateTabFavicon = (id: string, favicon: string) => {
    setTabs(prev => prev.map(t =>
      t.id === id ? { ...t, favicon } : t
    ))
  }

  // Render tab helper
  const renderTab = (tab: Tab) => (
    <div
      key={tab.id}
      onClick={() => setActiveTabId(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        const index = tabs.findIndex(t => t.id === tab.id)
        ipcRenderer.invoke('show-tab-context-menu', {
          tabId: tab.id,
          hasTabsToRight: index < tabs.length - 1,
          type: tab.type
        })
      }}
      className={cn(
        "group flex items-center px-4 py-1 cursor-pointer transition-all duration-200 text-sm border-b border-zinc-900",
        activeTabId === tab.id
          ? "bg-zinc-800 text-zinc-100 border-l-2 border-l-white"
          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
      )}
    >
      <div className="w-4 h-4 mr-3 flex-shrink-0 flex items-center justify-center">
        {tab.favicon ? (
          <img src={tab.favicon} className="w-4 h-4 object-contain" alt="" />
        ) : (
          <i className="ri-global-line text-xs opacity-70"></i>
        )}
      </div>

      {sidebarOpen && (
        <>
          <span className="truncate flex-1 text-xs font-medium">{tab.title}</span>
          <div
            onClick={(e) => closeTab(e, tab.id)}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all"
          >
            <i className="ri-close-line text-xs"></i>
          </div>
        </>
      )}
    </div>
  )

  const addWorkspace = () => {
    const newId = (workspaces.length + 1).toString()
    const randomColor = WORKSPACE_COLORS[Math.floor(Math.random() * WORKSPACE_COLORS.length)]

    const newWorkspace: Workspace = {
      id: newId,
      name: `Space ${newId}`,
      color: randomColor,
      icon: 'ri-layout-grid-line'
    }

    setWorkspaces([...workspaces, newWorkspace])
    setActiveWorkspaceId(newId)

    // Create a default new tab for the new workspace
    const newTabId = Math.random().toString(36).substr(2, 9)
    const newTab: Tab = {
      id: newTabId,
      url: 'https://google.com',
      initialUrl: 'https://google.com',
      title: 'New Tab',
      favicon: getFaviconUrl('https://google.com'),
      type: 'standard',
      workspaceId: newId
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTabId)
  }

  const handleWorkspaceContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingWorkspaceId(id)
    setEditPosition({ x: e.clientX, y: e.clientY })
  }

  const updateWorkspace = (id: string, updates: Partial<Workspace>) => {
    setWorkspaces(prev => prev.map(ws => ws.id === id ? { ...ws, ...updates } : ws))
  }

  const currentWorkspaceTabs = tabs.filter(t => t.workspaceId === activeWorkspaceId)
  const favorites = currentWorkspaceTabs.filter(t => t.type === 'favorite')
  const pinnedTabs = currentWorkspaceTabs.filter(t => t.type === 'pinned')
  const standardTabs = currentWorkspaceTabs.filter(t => t.type === 'standard' || !t.type)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <div className={cn(
        "flex flex-col border-r border-border/10 bg-zinc-950 transition-all duration-300 ease-in-out",
        sidebarOpen ? "w-56" : "w-12"
      )}>
        {/* Sidebar Header / Controls */}
        <div className="flex flex-col p-0 bg-zinc-900 border-b border-zinc-800">
          {sidebarOpen ? (
            <div className="flex items-center px-0 gap-0 w-full">
              {/* Drag Handle Button */}
              <div className="flex-1 w-0 h-8 flex items-center justify-center hover:bg-zinc-800 cursor-grab active:cursor-grabbing text-zinc-500 hover:text-zinc-300 transition-colors" style={{ WebkitAppRegion: 'drag' } as any}>
                <i className="ri-drag-move-2-fill text-lg"></i>
              </div>

              <Button variant="ghost" className="flex-1 w-0 h-8 rounded-none px-0 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={goBack}>
                <i className="ri-arrow-left-line text-lg"></i>
              </Button>
              <Button variant="ghost" className="flex-1 w-0 h-8 rounded-none px-0 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={goForward}>
                <i className="ri-arrow-right-line text-lg"></i>
              </Button>
              <Button variant="ghost" className="flex-1 w-0 h-8 rounded-none px-0 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={reload}>
                <i className="ri-refresh-line text-lg"></i>
              </Button>

              <Button
                variant="ghost"
                className="flex-1 w-0 h-8 rounded-none px-0 text-zinc-400 hover:text-white hover:bg-zinc-800"
                onClick={() => setSidebarOpen(false)}
              >
                <i className="ri-layout-left-line text-lg"></i>
              </Button>
            </div>
          ) : (
            /* Collapsed State Controls */
            <div className="flex flex-col items-center gap-0 pb-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-none text-zinc-400 hover:text-white hover:bg-zinc-800"
                onClick={() => setSidebarOpen(true)}
              >
                <i className="ri-layout-left-line text-lg"></i>
              </Button>
            </div>
          )}

          {/* URL Bar (in sidebar when open) */}
          {sidebarOpen && (
            <div className="p-0 bg-zinc-900 z-20 relative">
              <form onSubmit={handleNavigate}>
                <div className={cn(
                  "relative group flex flex-col bg-zinc-950 border-y border-zinc-800 rounded-none transition-all overflow-hidden",
                  showSecurityPopover && "border-zinc-700 shadow-lg"
                )}>
                  {/* Top Row: Lock + Input */}
                  <div className="relative h-9 flex items-center shrink-0">
                    {/* Secure Button */}
                    <button
                      type="button"
                      onClick={() => setShowSecurityPopover(!showSecurityPopover)}
                      className={cn(
                        "absolute left-1.5 w-6 h-6 flex items-center justify-center rounded-none transition-all z-10 select-none",
                        activeTab?.url.startsWith('https')
                          ? "hover:bg-zinc-800 text-emerald-500"
                          : "hover:bg-red-900/30 text-red-500"
                      )}
                      title={activeTab?.url.startsWith('https') ? "Secure Connection" : "Not Secure"}
                    >
                      <i className={cn(
                        "text-xs",
                        activeTab?.url.startsWith('https') ? "ri-lock-fill" : "ri-lock-unlock-line"
                      )}></i>
                    </button>

                    <Input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      className="pl-9 w-full h-full text-xs bg-transparent border-none focus-visible:ring-0 text-zinc-300 placeholder:text-zinc-600 transition-all"
                      placeholder="Search or enter URL..."
                    />
                  </div>

                  {/* Security Expandable Section */}
                  {showSecurityPopover && (
                    <div className="border-t border-zinc-800/50 p-0 animate-in slide-in-from-top-2 duration-200 bg-zinc-900/30">
                      {/* Header Actions */}
                      <div className="grid grid-cols-4 gap-0 mb-0 border-b border-zinc-800">
                        <button
                          type="button"
                          onClick={toggleFavorite}
                          className={cn(
                            "h-8 flex items-center justify-center gap-0 p-0 rounded-none transition-all border-r border-zinc-800 last:border-r-0 active:bg-zinc-800",
                            activeTab?.type === 'favorite'
                              ? "bg-zinc-800 text-yellow-500"
                              : "bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          )}
                          title="Bookmark"
                        >
                          <i className={cn("text-base", activeTab?.type === 'favorite' ? "ri-bookmark-fill" : "ri-bookmark-line")}></i>
                        </button>
                        <button
                          type="button"
                          onClick={handleScreenshot}
                          className="h-8 flex items-center justify-center gap-0 p-0 rounded-none bg-transparent border-r border-zinc-800 last:border-r-0 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all"
                          title="Take Screenshot (Copy to Clipboard)"
                        >
                          <i className="ri-camera-lens-line text-base"></i>
                        </button>
                        <button type="button" className="h-8 flex items-center justify-center gap-0 p-0 rounded-none bg-transparent border-r border-zinc-800 last:border-r-0 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all">
                          <i className="ri-article-line text-base"></i>
                        </button>
                        <button
                          type="button"
                          onClick={copyUrl}
                          className="h-8 flex items-center justify-center gap-0 p-0 rounded-none bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all"
                          title="Copy URL"
                        >
                          <i className="ri-share-forward-line text-base"></i>
                        </button>
                      </div>

                      {/* Extensions Section */}
                      <div className="mb-0 border-b border-zinc-800">
                        <div className="flex items-center justify-between p-2 bg-zinc-950/50">
                          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Extensions</span>
                          <button
                            type="button"
                            onClick={() => {
                              ipcRenderer.invoke('open-settings-window')
                              setShowSecurityPopover(false)
                            }}
                            className="text-[10px] font-medium text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded-none hover:bg-zinc-800 transition-all"
                          >
                            Manage
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-0">
                          {extensionsList.slice(0, 5).map(ext => (
                            <div
                              key={ext.id}
                              className={cn(
                                "w-8 h-8 rounded-none border-r border-b border-zinc-800 flex items-center justify-center text-zinc-400 transition-all",
                                ext.popupPage ? "cursor-pointer hover:bg-zinc-800 hover:text-zinc-200" : "opacity-75 cursor-default"
                              )}
                              title={ext.name}
                              onClick={() => {
                                if (ext.popupPage) {
                                  // Pass active tab info to the popup for chrome.tabs API mocking
                                  ipcRenderer.invoke('extension:open-popup', {
                                    popupPage: ext.popupPage,
                                    activeTab: activeTab ? {
                                      id: activeTab.id,
                                      url: activeTab.url,
                                      title: activeTab.title
                                    } : null
                                  })
                                }
                              }}
                            >
                              {ext.iconUrl ? (
                                <img src={ext.iconUrl} className="w-5 h-5 object-contain" alt="" />
                              ) : (
                                <i className="ri-puzzle-line text-base"></i>
                              )}
                            </div>
                          ))}
                          {extensionsList.length === 0 && (
                            <span className="text-[10px] text-zinc-600 p-2 block">No extensions installed</span>
                          )}
                        </div>
                      </div>

                      {/* Tracking Protection */}
                      <div
                        className="group bg-transparent rounded-none p-2 border-b border-zinc-800 hover:bg-zinc-800 cursor-pointer transition-all"
                        onClick={() => setTrackingProtection(!trackingProtection)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-7 h-7 rounded-none flex items-center justify-center shrink-0 transition-colors",
                            trackingProtection ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                          )}>
                            <i className={cn("text-base", trackingProtection ? "ri-shield-check-line" : "ri-shield-line")}></i>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-zinc-200">Tracking Protection</div>
                            <div className="text-[10px] text-zinc-500">
                              {trackingProtection ? `On • ${blockedCount} blocked` : "Off"}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Footer Status */}
                      <div className="flex items-center justify-between p-2">
                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-zinc-800/30 rounded-none text-[10px] text-zinc-400">
                          <i className={cn("text-xs", activeTab?.url.startsWith('https') ? "ri-lock-fill text-emerald-500" : "ri-lock-unlock-line text-red-500")}></i>
                          <span>{activeTab?.url.startsWith('https') ? "Secure" : "Not Secure"}</span>
                        </div>
                        <button type="button" className="w-6 h-6 flex items-center justify-center rounded-none hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                          <i className="ri-more-fill text-xs"></i>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Tabs List */}
        <div className="overflow-y-auto py-0 space-y-0 bg-zinc-950 flex-1">
          {/* Favorites Section */}
          {favorites.length > 0 && (
            <div className={cn("grid gap-0 p-0 border-b border-zinc-900", sidebarOpen ? "grid-cols-4" : "grid-cols-1")}>
              {favorites.map(tab => (
                <div
                  key={tab.id}
                  onClick={() => {
                  setActiveTabId(tab.id)
                }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    ipcRenderer.invoke('show-tab-context-menu', { tabId: tab.id, type: tab.type })
                  }}
                  className={cn(
                    "aspect-square flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-zinc-800 rounded-none",
                    activeTabId === tab.id ? "bg-zinc-800 text-white" : "text-zinc-500"
                  )}
                  title={tab.title}
                >
                  {tab.favicon ? (
                    <img src={tab.favicon} className="w-6 h-6 object-contain" alt="" />
                  ) : (
                    <i className="ri-global-line text-lg"></i>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pinned Tabs Section */}
          {pinnedTabs.length > 0 && (
            <div className="flex flex-col border-b border-zinc-900">
              {sidebarOpen && <div className="px-4 py-1 text-[10px] font-bold text-zinc-600 uppercase tracking-wider">Pinned</div>}
              {pinnedTabs.map(renderTab)}
            </div>
          )}

          {/* Standard Tabs Section */}
          <div className="flex flex-col">
            {sidebarOpen && (favorites.length > 0 || pinnedTabs.length > 0) && (
              <div className="px-4 py-1 text-[10px] font-bold text-zinc-600 uppercase tracking-wider mt-0 border-t border-zinc-900">Today</div>
            )}
            {standardTabs.map(renderTab)}
          </div>

          {/* New Tab Button (Below Tabs) */}
          {sidebarOpen && (
            <div className="px-0">
              <Button variant="ghost" className="w-full justify-start rounded-none text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 h-7 px-4" onClick={createTab}>
                <i className="ri-add-line text-lg mr-2"></i>
                New Tab
              </Button>
            </div>
          )}
        </div>

        {/* Draggable Spacer */}
        <div className="bg-zinc-950 w-full flex-grow-0 h-4" style={{ WebkitAppRegion: 'drag' } as any}></div>

        {/* Sidebar Footer */}
        <div className="p-0 border-t border-zinc-800 bg-zinc-900 flex flex-col gap-0">
          {/* Workspace Switcher */}
          {sidebarOpen && (
            <div className="flex w-full h-3 bg-zinc-900">
              {workspaces.map(ws => (
                <div
                  key={ws.id}
                  onClick={() => setActiveWorkspaceId(ws.id)}
                  onContextMenu={(e) => handleWorkspaceContextMenu(e, ws.id)}
                  className={cn(
                    "flex-1 h-full cursor-pointer transition-all duration-200",
                    activeWorkspaceId === ws.id ? ws.color : "bg-zinc-800/50 hover:bg-zinc-700"
                  )}
                  title={ws.name}
                ></div>
              ))}

              <div
                onClick={addWorkspace}
                className="w-6 h-full flex items-center justify-center cursor-pointer bg-zinc-900 hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-all"
                title="Add Workspace"
              >
                <i className="ri-add-line text-[10px]"></i>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className={cn("justify-start rounded-none h-10 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 w-full px-4", !sidebarOpen && "justify-center px-0")}
            onClick={() => ipcRenderer.invoke('open-settings-window')}
          >
            <i className="ri-settings-3-line text-lg mr-2"></i>
            {sidebarOpen && <span className="text-xs">Settings</span>}
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative bg-background h-full w-full">
        {/* Workspace Editor Tooltip */}
        {editingWorkspaceId && editPosition && (
          <div
            className="fixed z-50 bg-zinc-900 border border-zinc-700 shadow-xl rounded-none p-4 w-64 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-100"
            style={{ left: 64, bottom: 60 }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Edit Space</span>
              <div
                onClick={() => setEditingWorkspaceId(null)}
                className="cursor-pointer text-zinc-500 hover:text-zinc-300"
              >
                <i className="ri-close-line text-lg"></i>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Name</label>
              <Input
                value={workspaces.find(w => w.id === editingWorkspaceId)?.name || ''}
                onChange={(e) => updateWorkspace(editingWorkspaceId, { name: e.target.value })}
                className="h-8 text-xs bg-zinc-950 border-zinc-800 focus:border-blue-500 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-500">Color</label>
              <div className="grid grid-cols-4 gap-2">
                {WORKSPACE_COLORS.map(color => (
                  <div
                    key={color}
                    onClick={() => updateWorkspace(editingWorkspaceId, { color })}
                    className={cn(
                      "w-8 h-8 rounded-none cursor-pointer hover:scale-110 transition-transform flex items-center justify-center",
                      color,
                      workspaces.find(w => w.id === editingWorkspaceId)?.color === color && "ring-2 ring-white ring-offset-2 ring-offset-zinc-900"
                    )}
                  >
                    {workspaces.find(w => w.id === editingWorkspaceId)?.color === color && (
                      <i className="ri-check-line text-white/90 text-sm"></i>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Edit overlay backdrop */}
        {editingWorkspaceId && (
          <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setEditingWorkspaceId(null)}></div>
        )}

        {/* Settings component removed - now in separate window */}

        {tabs.map(tab => (
              <div
                key={tab.id}
                className={cn(
                  "absolute inset-0 w-full h-full bg-background",
                  activeTabId === tab.id ? "z-10 flex" : "z-0 hidden"
                )}
              >
                <webview
                  src={tab.initialUrl || tab.url}
                  allowpopups={true as any}
                  className="w-full h-full"
                  useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
                  // Events for updating state
                  ref={(ref: any) => {
                    if (ref) {
                      webviewRefs.current[tab.id] = ref
                    }
                    if (ref && !ref.hasAttribute('data-listeners-attached')) {
                      ref.setAttribute('data-listeners-attached', 'true');

                      ref.addEventListener('dom-ready', () => {
                        // Inject spoofing script to bypass Chrome Web Store checks
                        ref.executeJavaScript(`
                                try {
                                  Object.defineProperty(navigator, 'webdriver', { get: () => false });
                                  Object.defineProperty(navigator, 'userAgentData', {
                                    get: () => ({
                                      brands: [
                                        { brand: 'Chromium', version: '132' },
                                        { brand: 'Google Chrome', version: '132' },
                                        { brand: 'Not(A:Brand', version: '99' }
                                      ],
                                      mobile: false,
                                      platform: 'Windows',
                                      getHighEntropyValues: async () => ({
                                         architecture: "x86",
                                         bitness: "64",
                                         brands: [
                                            { brand: 'Chromium', version: '132.0.0.0' },
                                            { brand: 'Google Chrome', version: '132.0.0.0' },
                                            { brand: 'Not(A:Brand', version: '99' }
                                         ],
                                         fullVersionList: [
                                            { brand: 'Chromium', version: '132.0.0.0' },
                                            { brand: 'Google Chrome', version: '132.0.0.0' },
                                            { brand: 'Not(A:Brand', version: '24.0.0.0' }
                                         ],
                                         mobile: false,
                                         model: "",
                                         platform: "Windows",
                                         platformVersion: "10.0.0",
                                         uaFullVersion: "132.0.0.0"
                                      })
                                    })
                                  });
                                } catch(e) {}

                                // Inject Solarium Extension Button
                                (function() {
                                    const injectButton = () => {
                                         try {
                                             if (window.location.hostname !== 'chromewebstore.google.com') return;
                                             
                                             const pathParts = window.location.pathname.split('/');
                                             const detailIndex = pathParts.indexOf('detail');
                                             if (detailIndex === -1) return;
                                             
                                             const extensionId = pathParts[pathParts.length - 1];
                                             if (!extensionId || !/^[a-z0-9]{32}$/.test(extensionId)) return;
                                             
                                             if (document.getElementById('solarium-install-btn')) return;
                                             
                                             const btn = document.createElement('button');
                                             btn.id = 'solarium-install-btn';
                                             
                                             // Apply styles safely using Object.assign or individual properties
                                             Object.assign(btn.style, {
                                                position: 'fixed',
                                                bottom: '30px',
                                                right: '30px',
                                                zIndex: '2147483647',
                                                padding: '16px 32px',
                                                backgroundColor: '#3b82f6',
                                                color: 'white',
                                                border: '2px solid white',
                                                borderRadius: '50px',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                boxShadow: '0 10px 30px rgba(59, 130, 246, 0.6)',
                                                fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                                                fontSize: '18px',
                                                transition: 'all 0.2s ease',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px'
                                             });
                                             
                                             const createSVG = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);
                                             
                                             const icon = createSVG('svg');
                                             icon.setAttribute('width', '24');
                                             icon.setAttribute('height', '24');
                                             icon.setAttribute('viewBox', '0 0 24 24');
                                             icon.setAttribute('fill', 'none');
                                             icon.setAttribute('stroke', 'currentColor');
                                             icon.setAttribute('stroke-width', '2');
                                             icon.setAttribute('stroke-linecap', 'round');
                                             icon.setAttribute('stroke-linejoin', 'round');
                                             
                                             const path = createSVG('path');
                                             path.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
                                             icon.appendChild(path);
                                             
                                             const polyline = createSVG('polyline');
                                             polyline.setAttribute('points', '7 10 12 15 17 10');
                                             icon.appendChild(polyline);
                                             
                                             const line = createSVG('line');
                                             line.setAttribute('x1', '12');
                                             line.setAttribute('x2', '12');
                                             line.setAttribute('y1', '15');
                                             line.setAttribute('y2', '3');
                                             icon.appendChild(line);
                                             
                                             btn.appendChild(icon);
                                             btn.appendChild(document.createTextNode(' Add to Solarium'));
                                             
                                             btn.onmouseover = () => { 
                                                 btn.style.transform = 'translateY(-4px) scale(1.05)'; 
                                                 btn.style.boxShadow = '0 20px 40px rgba(59, 130, 246, 0.7)'; 
                                             };
                                             btn.onmouseout = () => { 
                                                 btn.style.transform = 'translateY(0) scale(1)'; 
                                                 btn.style.boxShadow = '0 10px 30px rgba(59, 130, 246, 0.6)'; 
                                             };
                                             
                                             btn.onclick = () => {
                                                 btn.textContent = '';
                                                 btn.appendChild(document.createTextNode('Downloading...'));
                                                 btn.style.backgroundColor = '#f59e0b';
                                                 
                                                 const crxUrl = \`https://clients2.google.com/service/update2/crx?response=redirect&prodversion=132.0.0.0&acceptformat=crx2,crx3&x=id%3D\${extensionId}%26uc\`;
                                                 
                                                 const a = document.createElement('a');
                                                 a.href = crxUrl;
                                                 a.download = \`\${extensionId}.crx\`;
                                                 document.body.appendChild(a);
                                                 a.click();
                                                 document.body.removeChild(a);
                                                 
                                                 setTimeout(() => {
                                                     btn.textContent = '';
                                                     
                                                     const checkIcon = createSVG('svg');
                                                     checkIcon.setAttribute('width', '24');
                                                     checkIcon.setAttribute('height', '24');
                                                     checkIcon.setAttribute('viewBox', '0 0 24 24');
                                                     checkIcon.setAttribute('fill', 'none');
                                                     checkIcon.setAttribute('stroke', 'currentColor');
                                                     checkIcon.setAttribute('stroke-width', '2');
                                                     checkIcon.setAttribute('stroke-linecap', 'round');
                                                     checkIcon.setAttribute('stroke-linejoin', 'round');
                                                     
                                                     const checkPoly = createSVG('polyline');
                                                     checkPoly.setAttribute('points', '20 6 9 17 4 12');
                                                     checkIcon.appendChild(checkPoly);
                                                     
                                                     btn.appendChild(checkIcon);
                                                     btn.appendChild(document.createTextNode(' Installing...'));
                                                     btn.style.backgroundColor = '#10b981';
                                                 }, 2000);
                                             };
                                             
                                             document.body.appendChild(btn);
                                         } catch(e) {
                                             // Silently fail to avoid console noise
                                         }
                                     };
                                    
                                    // Run immediately
                                    injectButton();
                                    // And periodically to handle SPA navigation
                                    setInterval(injectButton, 1000);
                                })();
                              `);
                      });

                      ref.addEventListener('page-title-updated', (e: any) => {
                        updateTabInfo(tab.id, e.title, ref.getURL())
                      })
                      ref.addEventListener('did-navigate', (e: any) => {
                        updateTabInfo(tab.id, ref.getTitle(), ref.getURL())
                        // Inject content scripts from loaded extensions
                        ipcRenderer.invoke('extension:get-content-scripts', ref.getURL()).then((scripts: any[]) => {
                          for (const script of scripts) {
                            // Inject CSS first
                            for (const css of script.css) {
                              ref.insertCSS(css).catch((err: any) => console.error('[ContentScript] CSS inject failed:', err))
                            }
                            // Inject JS
                            for (const js of script.js) {
                              ref.executeJavaScript(js).catch((err: any) => console.error('[ContentScript] JS inject failed:', err))
                            }
                          }
                        }).catch(console.error)
                      })
                      ref.addEventListener('did-navigate-in-page', () => {
                        updateTabInfo(tab.id, ref.getTitle(), ref.getURL())
                      })
                      ref.addEventListener('did-stop-loading', () => {
                        updateTabInfo(tab.id, ref.getTitle(), ref.getURL())
                      })
                      ref.addEventListener('page-favicon-updated', (e: any) => {
                        if (e.favicons && e.favicons.length > 0) {
                          const url = ref.getURL()
                          // Use Google's high-quality favicon service for public websites
                          // This provides up to 128px icons which look much sharper
                          if (url.startsWith('http')) {
                            const highResIcon = getFaviconUrl(url)
                            if (highResIcon) {
                              updateTabFavicon(tab.id, highResIcon)
                              return
                            }
                          }
                          // Fallback for non-http protocols or errors
                          updateTabFavicon(tab.id, e.favicons[0])
                        }
                      })
                      ref.addEventListener('context-menu', (e: any) => {
                        e.preventDefault()
                        ipcRenderer.invoke('show-context-menu', {
                          x: e.params.x,
                          y: e.params.y,
                          linkURL: e.params.linkURL,
                          selectionText: e.params.selectionText,
                          mediaType: e.params.mediaType,
                          canGoBack: ref.canGoBack(),
                          canGoForward: ref.canGoForward()
                        })
                      })
                    }
                  }}
                />
              </div>
            ))}
      </div>
    </div>
  )
}

export default App
