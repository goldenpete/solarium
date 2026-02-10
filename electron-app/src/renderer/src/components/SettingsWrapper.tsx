import { useState } from 'react'
import { ipcRenderer } from 'electron'
import { Settings } from './Settings'

export default function SettingsWrapper() {
  const [defaultSearchEngine, setDefaultSearchEngine] = useState(() => localStorage.getItem('defaultSearchEngine') || 'google')

  const handleSearchEngineChange = (engine: string) => {
    setDefaultSearchEngine(engine)
    localStorage.setItem('defaultSearchEngine', engine)
    ipcRenderer.send('update-search-engine', engine)
  }

  const handleOpenTab = (url: string) => {
    ipcRenderer.send('create-tab-from-settings', url)
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 overflow-hidden border border-zinc-800">
      {/* Draggable Titlebar */}
      <div className="h-10 bg-zinc-950 flex items-center justify-between px-4 select-none draggable-region border-b border-zinc-900 shrink-0">
        <div className="text-xs text-zinc-500 font-medium flex items-center gap-2">
          <i className="ri-settings-3-line"></i>
          Solarium Settings
        </div>
        <div className="flex items-center gap-2 no-drag">
           <button 
            onClick={() => window.close()}
            className="w-6 h-6 flex items-center justify-center rounded-none hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
           >
            <i className="ri-close-line text-lg"></i>
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <Settings 
          onBack={() => window.close()}
          onOpenTab={handleOpenTab}
          defaultSearchEngine={defaultSearchEngine}
          onSearchEngineChange={handleSearchEngineChange}
        />
      </div>
    </div>
  )
}
