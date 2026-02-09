import { useState, useEffect, useRef } from 'react'
import { ipcRenderer } from 'electron'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, getFaviconUrl } from '@/lib/utils'
import { Settings } from '@/components/Settings'

interface Tab {
  id: string
  url: string
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

  const [tabs, setTabs] = useState<Tab[]>(() => getStoredState('savedTabs', [
    { id: '1', url: 'https://google.com', title: 'New Tab', favicon: getFaviconUrl('https://google.com'), type: 'standard', workspaceId: '1' }
  ]))

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
  const [showSettings, setShowSettings] = useState(false)
  const [defaultSearchEngine, setDefaultSearchEngine] = useState('google')
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [editPosition, setEditPosition] = useState<{x: number, y: number} | null>(null)
  const webviewRefs = useRef<{ [key: string]: Electron.WebviewTag }>({})

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
          const newTab: Tab = { id: newId, url, title: 'New Tab', type: 'standard', workspaceId: activeWorkspaceId }
          setTabs(prev => [...prev, newTab])
          setActiveTabId(newId)
          break
        case 'searchGoogle':
          const [text] = args
          const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(text)
          const searchId = Math.random().toString(36).substr(2, 9)
          const searchTab: Tab = { id: searchId, url: searchUrl, title: 'New Tab', type: 'standard', workspaceId: activeWorkspaceId }
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
    const newTab: Tab = {
      id: newId,
      url: url,
      title: 'New Tab',
      favicon: url !== 'https://google.com' ? getFaviconUrl(url) : undefined,
      type: 'standard',
      workspaceId: activeWorkspaceId
    }
    setTabs([...tabs, newTab])
    setActiveTabId(newId)
  }

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
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
        const searchUrls: {[key: string]: string} = {
            google: 'https://www.google.com/search?q=',
            bing: 'https://www.bing.com/search?q=',
            duckduckgo: 'https://duckduckgo.com/?q=',
            yahoo: 'https://search.yahoo.com/search?p='
        }
        url = (searchUrls[defaultSearchEngine] || searchUrls['google']) + encodeURIComponent(url)
      }
    }
    
    setTabs(tabs.map(t => 
      t.id === activeTabId ? { ...t, url } : t
    ))
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
        <div className="flex flex-col pt-2 pb-0 bg-zinc-900 border-b border-zinc-800">
           {sidebarOpen ? (
             <div className="flex items-center justify-between px-2 gap-0.5 pb-2">
                  {/* Drag Handle Button */}
                  <div className="h-8 w-8 flex items-center justify-center hover:bg-zinc-800 cursor-grab active:cursor-grabbing text-zinc-500 hover:text-zinc-300 transition-colors" style={{ WebkitAppRegion: 'drag' } as any}>
                    <i className="ri-drag-move-2-fill text-lg"></i>
                  </div>

                  <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={goBack}>
                    <i className="ri-arrow-left-line text-lg"></i>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={goForward}>
                    <i className="ri-arrow-right-line text-lg"></i>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={reload}>
                    <i className="ri-refresh-line text-lg"></i>
                  </Button>

                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800"
                    onClick={() => ipcRenderer.invoke('open-extensions-folder')}
                    title="Open Extensions Folder"
                  >
                    <i className="ri-puzzle-line text-lg"></i>
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <i className="ri-layout-left-line text-lg"></i>
                  </Button>
             </div>
           ) : (
             /* Collapsed State Controls */
             <div className="flex flex-col items-center gap-0 pb-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800"
                  onClick={() => setSidebarOpen(true)}
                >
                  <i className="ri-layout-left-line text-lg"></i>
                </Button>
             </div>
           )}
        
           {/* URL Bar (in sidebar when open) */}
           {sidebarOpen && (
             <div className="px-2 pb-2 bg-zinc-900">
                <form onSubmit={handleNavigate}>
                  <div className="relative group">
                    <i className="ri-search-line absolute left-3 top-2.5 text-zinc-500 group-focus-within:text-zinc-300 text-xs transition-colors"></i>
                    <Input 
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      className="pl-9 h-9 text-xs bg-zinc-950 border-zinc-800 hover:bg-zinc-950 focus:bg-zinc-950 focus:ring-1 focus:ring-zinc-700 text-zinc-300 placeholder:text-zinc-600 transition-all"
                      placeholder="Search or enter URL..."
                    />
                  </div>
                </form>
             </div>
           )}
        </div>

        {/* Tabs List */}
        <div className="overflow-y-auto py-0 space-y-0 bg-zinc-950 flex-1">
          {/* Favorites Section */}
          {favorites.length > 0 && (
            <div className={cn("grid gap-2 p-2 border-b border-zinc-900", sidebarOpen ? "grid-cols-4" : "grid-cols-1")}>
               {favorites.map(tab => (
                 <div
                   key={tab.id}
                   onClick={() => setActiveTabId(tab.id)}
                   onContextMenu={(e) => {
                     e.preventDefault()
                     ipcRenderer.invoke('show-tab-context-menu', { tabId: tab.id, type: tab.type })
                   }}
                   className={cn(
                     "aspect-square flex items-center justify-center cursor-pointer transition-all duration-200 border border-transparent hover:bg-zinc-800 hover:border-zinc-700 rounded-none",
                     activeTabId === tab.id ? "bg-zinc-800 text-white border-zinc-700" : "text-zinc-500"
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
               <div className="px-4 py-1 text-[10px] font-bold text-zinc-600 uppercase tracking-wider mt-2">Today</div>
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
                onClick={() => setShowSettings(true)}
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
              className="fixed z-50 bg-zinc-900 border border-zinc-700 shadow-xl rounded-lg p-4 w-64 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-100"
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
                          "w-8 h-8 rounded-full cursor-pointer hover:scale-110 transition-transform flex items-center justify-center",
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

         {showSettings ? (
            <Settings 
                onBack={() => setShowSettings(false)} 
                onOpenTab={(url) => {
                    createTab(url)
                    setShowSettings(false)
                }}
                defaultSearchEngine={defaultSearchEngine}
                onSearchEngineChange={setDefaultSearchEngine}
            />
        ) : (
            <>
                {tabs.map(tab => (
                <div 
                    key={tab.id} 
                    className={cn(
                    "absolute inset-0 w-full h-full bg-background",
                    activeTabId === tab.id ? "z-10 flex" : "z-0 hidden"
                    )}
                >
                    <webview
                        src={tab.url}
                        className="w-full h-full"
                        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
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
                                        { brand: 'Chromium', version: '146' },
                                        { brand: 'Google Chrome', version: '146' },
                                        { brand: 'Not(A:Brand', version: '99' }
                                      ],
                                      mobile: false,
                                      platform: 'Windows',
                                      getHighEntropyValues: async () => ({
                                         architecture: "x86",
                                         bitness: "64",
                                         brands: [
                                            { brand: 'Chromium', version: '146.0.0.0' },
                                            { brand: 'Google Chrome', version: '146.0.0.0' },
                                            { brand: 'Not(A:Brand', version: '99' }
                                         ],
                                         fullVersionList: [
                                            { brand: 'Chromium', version: '146.0.0.0' },
                                            { brand: 'Google Chrome', version: '146.0.0.0' },
                                            { brand: 'Not(A:Brand', version: '24.0.0.0' }
                                         ],
                                         mobile: false,
                                         model: "",
                                         platform: "Windows",
                                         platformVersion: "10.0.0",
                                         uaFullVersion: "122.0.0.0"
                                      })
                                    })
                                  });
                                } catch(e) {}
                              `);
                            });

                            ref.addEventListener('page-title-updated', (e: any) => {
                                updateTabInfo(tab.id, e.title, ref.getURL())
                            })
                            ref.addEventListener('did-navigate', () => {
                                updateTabInfo(tab.id, ref.getTitle(), ref.getURL())
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
            </>
         )}
      </div>
    </div>
  )
}

export default App
