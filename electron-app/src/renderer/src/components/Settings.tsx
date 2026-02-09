import { useState, useEffect } from 'react'
import { ipcRenderer } from 'electron'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, getFaviconUrl } from '@/lib/utils'

interface SettingsProps {
  onBack: () => void
  onOpenTab: (url: string) => void
  defaultSearchEngine: string
  onSearchEngineChange: (engine: string) => void
}

export function Settings({ onBack, onOpenTab, defaultSearchEngine, onSearchEngineChange }: SettingsProps) {
  const [activeSection, setActiveSection] = useState('appearance')
  const [cookies, setCookies] = useState<Electron.Cookie[]>([])
  const [extensions, setExtensions] = useState<any[]>([])
  const [devMode, setDevMode] = useState(false)
  const [allSites, setAllSites] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSite, setSelectedSite] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'websites' | 'trackers'>('websites')
  const [sitePermissions, setSitePermissions] = useState<Record<string, Record<string, 'ask' | 'allow' | 'block'>>>({})
  const [siteStatuses, setSiteStatuses] = useState<Record<string, 'block' | 'limit' | 'trusted' | null>>({})
  const [showAllUsage, setShowAllUsage] = useState(false)
  const [siteUsage, setSiteUsage] = useState<{
    cookies: { count: number, size: number },
    indexdb: number,
    localstorage: number,
    serviceworkers: number,
    cachestorage: number
  } | null>(null)

  const PERMISSIONS = [
    { id: 'location', icon: 'ri-map-pin-line', label: 'Location' },
    { id: 'camera', icon: 'ri-camera-line', label: 'Camera' },
    { id: 'microphone', icon: 'ri-mic-line', label: 'Microphone' },
    { id: 'sensors', icon: 'ri-sensor-line', label: 'Motion sensors' },
    { id: 'notifications', icon: 'ri-notification-3-line', label: 'Notifications' },
    { id: 'javascript', icon: 'ri-javascript-line', label: 'JavaScript' },
    { id: 'images', icon: 'ri-image-line', label: 'Images' },
    { id: 'popups', icon: 'ri-external-link-line', label: 'Pop-ups and redirects' },
    { id: 'sound', icon: 'ri-volume-up-line', label: 'Sound' },
    { id: 'downloads', icon: 'ri-download-cloud-2-line', label: 'Automatic downloads' },
    { id: 'midi', icon: 'ri-piano-line', label: 'MIDI devices' },
    { id: 'usb', icon: 'ri-usb-line', label: 'USB devices' },
    { id: 'serial', icon: 'ri-cpu-line', label: 'Serial ports' },
    { id: 'editing', icon: 'ri-file-edit-line', label: 'File editing' },
    { id: 'clipboard', icon: 'ri-clipboard-line', label: 'Clipboard' },
    { id: 'payment', icon: 'ri-bank-card-line', label: 'Payment handlers' },
    { id: 'ar', icon: 'ri-eye-2-line', label: 'Augmented reality' },
    { id: 'vr', icon: 'ri-eye-line', label: 'Virtual reality' },
    { id: 'insecure', icon: 'ri-shield-keyhole-line', label: 'Insecure content' },
    { id: 'device', icon: 'ri-smartphone-line', label: 'Your device use' },
    { id: 'signin', icon: 'ri-account-circle-line', label: 'Third-party sign-in' },
    { id: 'sync', icon: 'ri-refresh-line', label: 'Background sync' },
    { id: 'zoom', icon: 'ri-zoom-in-line', label: 'Zoom levels' },
    { id: 'pdf', icon: 'ri-file-pdf-line', label: 'PDF documents' },
    { id: 'protected', icon: 'ri-key-2-line', label: 'Protected content IDs' }
  ]

  const TRACKER_DOMAINS = [
    'doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 
    'google-analytics.com', 'facebook.net', 'adnxs.com', 'adsrvr.org', 
    'analytics', 'tracker', 'metrics', 'pixel', 'adsystem', 'criteo', 
    'moatads', 'ads', '2mdn', 'krxd'
  ]

  const isTracker = (domain: string) => {
    return TRACKER_DOMAINS.some(d => domain.includes(d))
  }

  const formatBytes = (bytes: number, decimals = 1) => {
      if (bytes === 0) return '0 B'
      const k = 1024
      const dm = decimals < 0 ? 0 : decimals
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
  }

  useEffect(() => {
    if (selectedSite) {
        ipcRenderer.invoke('get-site-data-usage', selectedSite).then(setSiteUsage)
    } else {
        setSiteUsage(null)
    }
  }, [selectedSite])

  useEffect(() => {
    // Fetch cookies when websites section is active
    if (activeSection === 'websites') {
        ipcRenderer.invoke('get-all-cookies').then((allCookies: Electron.Cookie[]) => {
            setCookies(allCookies)
            // Extract unique domains
            const domains = Array.from(new Set(allCookies.map(c => (c.domain && c.domain.startsWith('.')) ? c.domain.substring(1) : c.domain || ''))).filter(Boolean) as string[]
            setAllSites(domains)
        })
    }
  }, [activeSection])

    // Load statuses from localStorage
    useEffect(() => {
        const storedStatuses = localStorage.getItem('siteStatuses')
        if (storedStatuses) {
            const parsed = JSON.parse(storedStatuses)
            setSiteStatuses(parsed)
            // Sync with main process on load as well
            Object.entries(parsed).forEach(([site, status]) => {
                ipcRenderer.invoke('update-site-status', site, status)
            })
        }
    }, [])

    const updateSiteStatus = (site: string, status: 'block' | 'limit' | 'trusted' | null) => {
        setSiteStatuses(prev => {
            const next = { ...prev, [site]: status }
            localStorage.setItem('siteStatuses', JSON.stringify(next))
            // Sync with main process for enforcement
            ipcRenderer.invoke('update-site-status', site, status)
            return next
        })
    }

    const handleRemoveCookies = async (domain: string) => {
    await ipcRenderer.invoke('remove-cookies-for-domain', domain)
    // Refresh cookies
    const allCookies: Electron.Cookie[] = await ipcRenderer.invoke('get-all-cookies')
    setCookies(allCookies)
    const domains = Array.from(new Set(allCookies.map(c => (c.domain && c.domain.startsWith('.')) ? c.domain.substring(1) : c.domain || ''))).filter(Boolean) as string[]
    setAllSites(domains)
    // Refresh usage
    if (selectedSite) {
        ipcRenderer.invoke('get-site-data-usage', selectedSite).then(setSiteUsage)
    }
  }

  const handleRemoveData = async (types: string[]) => {
    if (!selectedSite) return
    await ipcRenderer.invoke('remove-site-data', { domain: selectedSite, types })
    // Refresh usage
    ipcRenderer.invoke('get-site-data-usage', selectedSite).then(setSiteUsage)
  }

  const handleClearPermissions = () => {
    if (!selectedSite) return
    setSitePermissions(prev => {
        const next = { ...prev }
        delete next[selectedSite]
        return next
    })
  }

  const getDisplayName = (domain: string) => {
    let name = domain
    if (name.startsWith('www.')) name = name.substring(4)
    const parts = name.split('.')
    if (parts.length > 0) {
        name = parts[0]
    }
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  const handlePermissionClick = (site: string, permissionId: string) => {
    setSitePermissions(prev => {
        const sitePerms = prev[site] || {}
        const current = sitePerms[permissionId] || 'ask'
        let next: 'ask' | 'allow' | 'block' = 'ask'
        
        if (current === 'ask') next = 'allow'
        else if (current === 'allow') next = 'block'
        else next = 'ask'
        
        return {
            ...prev,
            [site]: {
                ...sitePerms,
                [permissionId]: next
            }
        }
    })
  }

  const getPermissionState = (site: string, permissionId: string) => {
      return sitePermissions[site]?.[permissionId] || 'ask'
  }

    // Load extensions
    useEffect(() => {
        if (activeSection === 'extensions') {
            ipcRenderer.invoke('get-extensions').then(setExtensions)
        }
    }, [activeSection])

    const handleLoadUnpacked = async () => {
        const result = await ipcRenderer.invoke('load-unpacked-extension')
        if (result.success) {
            ipcRenderer.invoke('get-extensions').then(setExtensions)
        }
    }

    const handleRemoveExtension = async (id: string) => {
        const result = await ipcRenderer.invoke('remove-extension', id)
        if (result.success) {
            ipcRenderer.invoke('get-extensions').then(setExtensions)
        }
    }

    const handleBack = () => {
    if (selectedSite) {
        setSelectedSite(null)
    } else {
        onBack()
    }
  }

  type SectionItem = 
    | { type: 'divider'; id?: undefined; label?: undefined; icon?: undefined; external?: undefined }
    | { type?: undefined; id: string; label: string; icon: string; external?: boolean }

  const sections: SectionItem[] = [
    { id: 'profiles', label: 'Profiles', icon: 'ri-user-3-line' },
    { id: 'appearance', label: 'Appearance and behavior', icon: 'ri-layout-3-line' },
    { id: 'websites', label: 'Websites', icon: 'ri-global-line' },
    { id: 'extensions', label: 'Extensions', icon: 'ri-puzzle-2-line' },
    { id: 'privacy', label: 'Privacy and security', icon: 'ri-shield-keyhole-line' },
    { id: 'performance', label: 'Performance', icon: 'ri-speed-up-line' },
    { id: 'search', label: 'Search engine', icon: 'ri-search-line' },
    { id: 'default', label: 'Default browser', icon: 'ri-layout-top-2-line' },
    { id: 'startup', label: 'On startup', icon: 'ri-power-line' },
    { type: 'divider' },
    { id: 'languages', label: 'Languages', icon: 'ri-translate-2' },
    { id: 'downloads', label: 'Downloads', icon: 'ri-download-2-line' },
    { id: 'accessibility', label: 'Accessibility', icon: 'ri-accessibility-line' },
    { id: 'system', label: 'System', icon: 'ri-tools-line' },
    { id: 'reset', label: 'Reset settings', icon: 'ri-refresh-line' },
    { type: 'divider' },
    { id: 'about', label: 'About Solarium', icon: 'ri-information-line' },
  ]

  const filteredSites = allSites.filter(site => {
    if (!site) return false
    const matchesSearch = site.toLowerCase().includes(searchQuery.toLowerCase())
    
    if (filterType === 'trackers') {
        return matchesSearch && isTracker(site)
    } else {
        // 'websites' filter - show non-trackers? Or all? 
        // User said: "2 options will be "Websites" and "Trackers", it will be able to detect ones that are specificely trackers and which ones are websites."
        // This implies mutually exclusive lists.
        return matchesSearch && !isTracker(site)
    }
  })

  return (
    <div className="flex h-full w-full bg-zinc-950 text-zinc-100 font-sans animate-in fade-in duration-200">
      {/* Settings Sidebar */}
      <div className="w-64 border-r border-zinc-800 flex flex-col pt-2">
        <div className="px-6 pb-4 pt-2 flex items-center gap-3">
           <h1 className="text-xl font-medium">Settings</h1>
        </div>
        
        <div className="flex-1 overflow-y-auto py-2">
          {sections.map((section, index) => {
            if (section.type === 'divider') {
                return <div key={index} className="h-px bg-zinc-800 my-2 mx-0" />
            }
            return (
                <button
                key={section.id}
                onClick={() => {
                    setActiveSection(section.id!)
                }}
                className={cn(
                    "w-full flex items-center gap-4 px-6 py-2 text-sm transition-colors text-left",
                    activeSection === section.id 
                    ? "bg-blue-900/20 text-blue-400 border-r-2 border-blue-400" 
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                )}
                >
                <i className={cn(section.icon, "text-lg opacity-80")}></i>
                <span className="flex-1">{section.label}</span>
                {section.external && <i className="ri-external-link-line text-xs opacity-50"></i>}
                </button>
            )
          })}
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 bg-zinc-900 overflow-y-auto">
        <div className="max-w-4xl mx-auto py-12 px-12 space-y-8">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={handleBack} className="text-zinc-400 hover:text-white hover:bg-zinc-800 h-10 w-10 -ml-2">
                        <i className="ri-arrow-left-line text-xl"></i>
                    </Button>
                    {selectedSite ? (
                        <div className="flex items-center gap-4">
                             <div className="w-12 h-12 rounded bg-zinc-900 flex items-center justify-center text-zinc-500 overflow-hidden shrink-0 border border-zinc-800">
                                <img 
                                    src={getFaviconUrl(selectedSite)}
                                    alt={selectedSite}
                                    className="w-7 h-7 object-contain opacity-80"
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                    }}
                                />
                                <i className="ri-global-line hidden text-2xl"></i>
                            </div>
                            <div>
                                <h1 className="text-2xl font-medium leading-none mb-1 flex items-center gap-2">
                                    {getDisplayName(selectedSite)}
                                    <button 
                                        onClick={() => onOpenTab(`https://${selectedSite}`)}
                                        className="w-6 h-6 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                                        title={`Open ${selectedSite}`}
                                    >
                                        <i className="ri-external-link-line text-sm"></i>
                                    </button>
                                </h1>
                                <div className="text-sm text-zinc-500">{selectedSite}</div>
                            </div>
                        </div>
                    ) : (
                        <h1 className="text-2xl font-medium">
                             {sections.find(s => s.id === activeSection)?.label}
                        </h1>
                    )}
                </div>

                {selectedSite && (
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => updateSiteStatus(selectedSite, siteStatuses[selectedSite] === 'block' ? null : 'block')}
                            className={cn(
                                "w-8 h-8 flex items-center justify-center border transition-colors",
                                siteStatuses[selectedSite] === 'block' 
                                    ? "bg-red-900/20 border-red-800 text-red-500" 
                                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                            )}
                            title="Block this site"
                        >
                            <i className="ri-prohibited-line"></i>
                        </button>
                        <button 
                            onClick={() => updateSiteStatus(selectedSite, siteStatuses[selectedSite] === 'limit' ? null : 'limit')}
                            className={cn(
                                "w-8 h-8 flex items-center justify-center border transition-colors",
                                siteStatuses[selectedSite] === 'limit' 
                                    ? "bg-orange-900/20 border-orange-800 text-orange-500" 
                                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                            )}
                            title="Limit data saving"
                        >
                            <i className="ri-hard-drive-line"></i>
                        </button>
                        <button 
                            onClick={() => updateSiteStatus(selectedSite, siteStatuses[selectedSite] === 'trusted' ? null : 'trusted')}
                            className={cn(
                                "w-8 h-8 flex items-center justify-center border transition-colors",
                                siteStatuses[selectedSite] === 'trusted' 
                                    ? "bg-blue-900/20 border-blue-800 text-blue-500" 
                                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                            )}
                            title="Mark as Trusted"
                        >
                            <i className="ri-shield-check-line"></i>
                        </button>
                    </div>
                )}

                {activeSection === 'websites' && !selectedSite && (
                    <div className="flex items-center gap-3">
                         <div className="relative">
                            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"></i>
                            <input 
                                type="text" 
                                placeholder="Search..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="bg-zinc-950 border border-zinc-800 text-sm py-1.5 pl-9 pr-4 text-zinc-200 outline-none focus:border-blue-500 w-64 placeholder:text-zinc-600"
                            />
                        </div>
                        <select 
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value as 'websites' | 'trackers')}
                            className="bg-zinc-950 border border-zinc-800 text-sm py-1.5 px-3 text-zinc-200 outline-none focus:border-blue-500 cursor-pointer"
                        >
                            <option value="websites">Websites</option>
                            <option value="trackers">Trackers</option>
                        </select>
                    </div>
                )}
                {activeSection === 'extensions' && (
                    <div className="flex items-center gap-4">
                        <div className="text-sm text-zinc-400">Developer mode</div>
                        <div 
                            className={cn(
                                "w-10 h-5 rounded-full relative cursor-pointer transition-colors duration-200",
                                devMode ? "bg-blue-600" : "bg-zinc-700"
                            )}
                            onClick={() => setDevMode(!devMode)}
                        >
                            <div className={cn(
                                "absolute top-0.5 bottom-0.5 w-4 rounded-full bg-white transition-transform duration-200",
                                devMode ? "right-0.5" : "left-0.5"
                            )}></div>
                        </div>
                    </div>
                )}
            </div>

            {activeSection === 'appearance' && !selectedSite && (
                <div className="space-y-6">
                    <div className="bg-zinc-950 p-4 border border-zinc-800">
                        <h3 className="text-sm font-medium mb-4 text-zinc-400 uppercase tracking-wider">Theme</h3>
                        <div className="flex items-center justify-between py-2 border-b border-zinc-900">
                            <span>Mode</span>
                            <select className="bg-zinc-900 border border-zinc-700 text-sm p-1 text-zinc-300 outline-none focus:border-blue-500">
                                <option>Dark</option>
                                <option disabled>Light (Coming Soon)</option>
                                <option disabled>System</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between py-2 mt-2">
                            <span>Show Home Button</span>
                             <div className="w-10 h-5 bg-blue-600 relative cursor-pointer">
                                <div className="absolute right-0.5 top-0.5 bottom-0.5 w-4 bg-white"></div>
                             </div>
                        </div>
                    </div>
                </div>
            )}

            {activeSection === 'websites' && !selectedSite && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-2">
                        {filteredSites.map(site => (
                                <div 
                                    key={site} 
                                    onClick={() => setSelectedSite(site)}
                                    className="bg-zinc-950 border border-zinc-800 p-4 hover:border-zinc-700 cursor-pointer transition-colors group flex items-center justify-between"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded bg-zinc-900 flex items-center justify-center text-zinc-500 overflow-hidden shrink-0 border border-zinc-800">
                                            <img 
                                                src={`https://www.google.com/s2/favicons?domain=${site}&sz=128`}
                                                alt={site}
                                                className="w-6 h-6 object-contain opacity-80"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                }}
                                            />
                                            <i className="ri-global-line hidden text-xl"></i>
                                        </div>
                                        <div>
                                            <div className="font-medium text-zinc-200 text-base">{getDisplayName(site)}</div>
                                            <div className="text-xs text-zinc-500 mt-0.5">{site}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {siteStatuses[site] === 'block' && (
                                            <div className="text-xs text-red-500 bg-red-900/20 px-2 py-1 border border-red-800 flex items-center gap-1">
                                                <i className="ri-prohibited-line"></i> Blocked
                                            </div>
                                        )}
                                        {siteStatuses[site] === 'limit' && (
                                            <div className="text-xs text-orange-500 bg-orange-900/20 px-2 py-1 border border-orange-800 flex items-center gap-1">
                                                <i className="ri-hard-drive-line"></i> Limited
                                            </div>
                                        )}
                                        {siteStatuses[site] === 'trusted' && (
                                            <div className="text-xs text-blue-500 bg-blue-900/20 px-2 py-1 border border-blue-800 flex items-center gap-1">
                                                <i className="ri-shield-check-line"></i> Trusted
                                            </div>
                                        )}
                                        <div className="text-xs text-zinc-500 bg-zinc-900 px-2 py-1 border border-zinc-800">
                                            {cookies.filter(c => c.domain && c.domain.includes(site)).length} cookies
                                        </div>
                                        <i className="ri-arrow-right-s-line text-zinc-600 group-hover:text-zinc-400 text-lg"></i>
                                    </div>
                                </div>
                            ))}
                        
                        {filteredSites.length === 0 && (
                             <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-800 bg-zinc-950/50">
                                <i className="ri-earth-line text-4xl mb-3 block opacity-30"></i>
                                {searchQuery ? 'No websites match your search' : 'No websites found'}
                             </div>
                        )}
                    </div>
                </div>
            )}

            {activeSection === 'websites' && selectedSite && (
                <div className="space-y-6 animate-in zoom-in-95 fade-in duration-300">
                    <div className="bg-zinc-950 p-4 border border-zinc-800">
                        <h3 className="text-sm font-medium mb-4 text-zinc-400 uppercase tracking-wider">Usage</h3>
                        
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            {/* Card 1: Cookies */}
                            <div className="bg-zinc-900/30 border border-zinc-800 p-3 flex flex-col justify-between group hover:border-zinc-700 transition-colors relative">
                                <div className="flex justify-between items-start mb-2">
                                     <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-700">
                                        <img 
                                            src={`https://www.google.com/s2/favicons?domain=${selectedSite}&sz=128`}
                                            alt={selectedSite}
                                            className="w-4 h-4 object-contain opacity-80"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                            }}
                                        />
                                        <i className="ri-database-2-line hidden text-sm"></i>
                                     </div>
                                     <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => selectedSite && handleRemoveCookies(selectedSite)}
                                        className="h-6 w-6 -mr-2 -mt-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                                     >
                                        <i className="ri-delete-bin-line"></i>
                                     </Button>
                                </div>
                                <div>
                                    <div className="font-medium text-zinc-200 text-sm">Cookies</div>
                                    <div className="text-xs text-zinc-500 mt-1 truncate">
                                        {siteUsage?.cookies?.count ?? 0} ({siteUsage?.cookies?.size ? formatBytes(siteUsage.cookies.size) : '0 B'})
                                    </div>
                                </div>
                            </div>

                            {/* Card 2: Local Storage */}
                            <div className="bg-zinc-900/30 border border-zinc-800 p-3 flex flex-col justify-between group hover:border-zinc-700 transition-colors relative">
                                <div className="flex justify-between items-start mb-2">
                                     <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-700">
                                        <i className="ri-file-list-3-line text-lg"></i>
                                     </div>
                                     <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleRemoveData(['localstorage'])}
                                        className="h-6 w-6 -mr-2 -mt-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                                     >
                                        <i className="ri-delete-bin-line"></i>
                                     </Button>
                                </div>
                                <div>
                                    <div className="font-medium text-zinc-200 text-sm">Local Storage</div>
                                    <div className="text-xs text-zinc-500 mt-1 truncate">
                                        Preferences & data
                                    </div>
                                </div>
                            </div>

                            {/* Card 3: Cache Storage */}
                            <div className="bg-zinc-900/30 border border-zinc-800 p-3 flex flex-col justify-between group hover:border-zinc-700 transition-colors relative">
                                <div className="flex justify-between items-start mb-2">
                                     <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-700">
                                        <i className="ri-hard-drive-2-line text-lg"></i>
                                     </div>
                                     <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleRemoveData(['cachestorage'])}
                                        className="h-6 w-6 -mr-2 -mt-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                                     >
                                        <i className="ri-delete-bin-line"></i>
                                     </Button>
                                </div>
                                <div>
                                    <div className="font-medium text-zinc-200 text-sm">Cache Storage</div>
                                    <div className="text-xs text-zinc-500 mt-1 truncate">
                                        Images & files
                                    </div>
                                </div>
                            </div>
                        </div>

                        <Button 
                            variant="outline" 
                            className="w-full justify-between border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                            onClick={() => setShowAllUsage(!showAllUsage)}
                        >
                            <span className="text-xs uppercase tracking-wider font-medium">More Options</span>
                            <i className={cn("ri-arrow-down-s-line transition-transform duration-200", showAllUsage && "rotate-180")}></i>
                        </Button>

                        {showAllUsage && (
                            <div className="mt-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
                                {/* IndexedDB */}
                                <div className="flex items-center justify-between py-2 border-b border-zinc-900 mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 overflow-hidden shrink-0 border border-zinc-800">
                                            <i className="ri-database-line text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-sm text-zinc-200">
                                                IndexedDB
                                            </div>
                                            <div className="text-xs text-zinc-500">
                                                {siteUsage?.indexdb ? `${formatBytes(siteUsage.indexdb)} • ` : ''}Databases and offline content
                                            </div>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleRemoveData(['indexdb'])}
                                        className="text-zinc-400 hover:text-red-400 hover:bg-zinc-900"
                                    >
                                        <i className="ri-delete-bin-line"></i>
                                    </Button>
                                </div>

                                {/* Service Workers */}
                                <div className="flex items-center justify-between py-2 border-b border-zinc-900 mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 overflow-hidden shrink-0 border border-zinc-800">
                                            <i className="ri-cpu-line text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-sm text-zinc-200">
                                                Service Workers
                                            </div>
                                            <div className="text-xs text-zinc-500">
                                                Workers, registrations, and push notifications
                                            </div>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleRemoveData(['serviceworkers'])}
                                        className="text-zinc-400 hover:text-red-400 hover:bg-zinc-900"
                                    >
                                        <i className="ri-delete-bin-line"></i>
                                    </Button>
                                </div>

                                {/* File System & Media */}
                                <div className="flex items-center justify-between py-2 border-b border-zinc-900 mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 overflow-hidden shrink-0 border border-zinc-800">
                                            <i className="ri-folder-keyhole-line text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-sm text-zinc-200">
                                                File System & Media
                                            </div>
                                            <div className="text-xs text-zinc-500">
                                                File System API and media licenses
                                            </div>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleRemoveData(['filesystem'])}
                                        className="text-zinc-400 hover:text-red-400 hover:bg-zinc-900"
                                    >
                                        <i className="ri-delete-bin-line"></i>
                                    </Button>
                                </div>

                                {/* WebAssembly & Shader Cache */}
                                <div className="flex items-center justify-between py-2 border-b border-zinc-900 mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 overflow-hidden shrink-0 border border-zinc-800">
                                            <i className="ri-code-box-line text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-sm text-zinc-200">
                                                WebAssembly Cache
                                            </div>
                                            <div className="text-xs text-zinc-500">
                                                Compiled WASM and GPU shaders
                                            </div>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleRemoveData(['shadercache'])}
                                        className="text-zinc-400 hover:text-red-400 hover:bg-zinc-900"
                                    >
                                        <i className="ri-delete-bin-line"></i>
                                    </Button>
                                </div>

                                {/* Application Cache */}
                                <div className="flex items-center justify-between py-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center text-zinc-400 overflow-hidden shrink-0 border border-zinc-800">
                                            <i className="ri-archive-line text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-sm text-zinc-200">
                                                Application Cache
                                            </div>
                                            <div className="text-xs text-zinc-500">
                                                Legacy application cache
                                            </div>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleRemoveData(['appcache'])}
                                        className="text-zinc-400 hover:text-red-400 hover:bg-zinc-900"
                                    >
                                        <i className="ri-delete-bin-line"></i>
                                    </Button>
                                </div>


                            </div>
                        )}
                    </div>

                    <div className="bg-zinc-950 p-4 border border-zinc-800">
                        <h3 className="text-sm font-medium mb-4 text-zinc-400 uppercase tracking-wider">Permissions</h3>
                        <div className="grid grid-cols-8 gap-2">
                             {PERMISSIONS.map(perm => {
                                const state = getPermissionState(selectedSite, perm.id)
                                return (
                                    <div key={perm.id} className="relative group">
                                        <button
                                            onClick={() => handlePermissionClick(selectedSite, perm.id)}
                                            className={cn(
                                                "w-full aspect-square flex items-center justify-center border transition-all",
                                                state === 'ask' && "bg-yellow-500/10 border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/20",
                                                state === 'allow' && "bg-green-500/10 border-green-500/50 text-green-500 hover:bg-green-500/20",
                                                state === 'block' && "bg-red-500/10 border-red-500/50 text-red-500 hover:bg-red-500/20"
                                            )}
                                        >
                                            <i className={cn(perm.icon, "text-2xl")}></i>
                                        </button>
                                        
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
                                            {perm.label}: {state.charAt(0).toUpperCase() + state.slice(1)}
                                        </div>
                                    </div>
                                )
                            })}
                            
                            {/* Reset Button */}
                            <button
                                onClick={handleClearPermissions}
                                className="col-span-2 flex items-center justify-center gap-3 border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all group"
                            >
                                <i className="ri-refresh-line text-xl group-hover:rotate-180 transition-transform duration-500"></i>
                                <span className="text-sm font-medium">Reset All</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeSection === 'search' && (
                <div className="space-y-6">
                    <div className="bg-zinc-950 p-4 border border-zinc-800">
                        <h3 className="text-sm font-medium mb-4 text-zinc-400 uppercase tracking-wider">Search Engine used in the address bar</h3>
                        <div className="flex items-center justify-between py-2">
                            <span>Search Engine</span>
                            <select 
                                value={defaultSearchEngine}
                                onChange={(e) => onSearchEngineChange(e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-sm p-1 text-zinc-300 outline-none focus:border-blue-500 min-w-[150px]"
                            >
                                <option value="google">Google</option>
                                <option value="bing">Bing</option>
                                <option value="duckduckgo">DuckDuckGo</option>
                                <option value="yahoo">Yahoo</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {activeSection === 'privacy' && (
                <div className="space-y-6">
                    <div className="bg-zinc-950 p-4 border border-zinc-800">
                         <h3 className="text-sm font-medium mb-4 text-zinc-400 uppercase tracking-wider">Clear Browsing Data</h3>
                         <div className="flex items-center justify-between py-2">
                            <div>
                                <div className="text-sm">Clear history, cookies, cache, and more</div>
                            </div>
                            <Button variant="outline" className="h-8 text-xs border-zinc-700 hover:bg-zinc-800 text-zinc-300">
                                Clear data
                            </Button>
                         </div>
                    </div>
                </div>
            )}
            
            {activeSection === 'extensions' && (
                <div className="space-y-6">
                    {/* Dev Mode Toolbar */}
                    {devMode && (
                        <div className="flex items-center gap-2 mb-6 animate-in slide-in-from-top-2">
                            <button 
                                onClick={handleLoadUnpacked}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded transition-colors border border-zinc-700"
                            >
                                Load unpacked
                            </button>
                            <button 
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded transition-colors border border-zinc-700 opacity-50 cursor-not-allowed"
                            >
                                Pack extension
                            </button>
                            <button 
                                onClick={() => {
                                    ipcRenderer.invoke('get-extensions').then(setExtensions)
                                }}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded transition-colors border border-zinc-700"
                            >
                                Update
                            </button>
                        </div>
                    )}

                    <div className="bg-zinc-950 p-6 border border-zinc-800">
                         <div className="flex items-center justify-between mb-8">
                            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Installed Extensions</h3>
                            <button 
                                onClick={() => onOpenTab('https://chromewebstore.google.com/')}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-full transition-colors shadow-lg shadow-blue-900/20"
                            >
                                <i className="ri-store-2-line"></i> 
                                Open Chrome Web Store
                            </button>
                         </div>
                         
                         {extensions.length === 0 ? (
                             <div className="flex flex-col items-center justify-center py-20 text-zinc-500 border border-dashed border-zinc-800 bg-zinc-900/30 rounded-lg">
                                <i className="ri-puzzle-2-line text-5xl mb-4 opacity-30"></i>
                                <p className="text-base font-medium text-zinc-400">No extensions installed</p>
                                <p className="text-sm text-zinc-600 mt-2">Extensions you install will appear here</p>
                             </div>
                         ) : (
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                 {extensions.map((ext: any) => (
                                     <div key={ext.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col h-full group hover:border-zinc-700 transition-colors">
                                         <div className="flex items-start justify-between mb-4">
                                             <div className="flex items-center gap-3">
                                                 <div className="w-10 h-10 bg-zinc-800 rounded flex items-center justify-center text-zinc-400 border border-zinc-700">
                                                     <i className="ri-puzzle-line text-xl"></i>
                                                 </div>
                                                 <div>
                                                     <h4 className="font-medium text-zinc-200 line-clamp-1">{ext.name}</h4>
                                                     <div className="text-xs text-zinc-500">{ext.version}</div>
                                                 </div>
                                             </div>
                                             <div className="flex items-center gap-1">
                                                 {devMode && (
                                                     <button 
                                                         onClick={() => handleRemoveExtension(ext.id)}
                                                         className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                                                         title="Remove"
                                                     >
                                                         <i className="ri-delete-bin-line"></i>
                                                     </button>
                                                 )}
                                                  <div className="w-10 h-6 bg-blue-600 rounded-full relative cursor-pointer">
                                                     <div className="absolute right-1 top-1 bottom-1 w-4 bg-white rounded-full"></div>
                                                  </div>
                                             </div>
                                         </div>
                                         
                                         <p className="text-xs text-zinc-500 mb-4 line-clamp-2 flex-1">
                                             {ext.description || 'No description available'}
                                         </p>
                                         
                                         <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
                                             <button className="text-xs text-zinc-400 hover:text-blue-400 transition-colors">
                                                 Details
                                             </button>
                                             {devMode && (
                                                 <div className="text-[10px] text-zinc-600 font-mono">
                                                     ID: {ext.id.substring(0, 8)}...
                                                 </div>
                                             )}
                                         </div>
                                         
                                         {devMode && (
                                            <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1">
                                                <div className="flex items-center gap-2 text-xs text-zinc-500">
                                                    <i className="ri-error-warning-line"></i>
                                                    <span>Inspect views</span>
                                                </div>
                                                <div className="pl-6">
                                                    <button className="text-blue-400 hover:underline text-xs">
                                                        background page
                                                    </button>
                                                </div>
                                            </div>
                                         )}
                                     </div>
                                 ))}
                             </div>
                         )}
                    </div>
                </div>
            )}
            
             {/* Placeholder for other sections */}
            {['profiles', 'performance', 'languages', 'downloads', 'accessibility', 'system', 'reset', 'about'].includes(activeSection) && !selectedSite && (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                    <i className="ri-tools-line text-4xl mb-4 opacity-50"></i>
                    <p>This section is under construction.</p>
                </div>
            )}
        </div>
      </div>
    </div>
  )
}
