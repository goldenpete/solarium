import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SettingsWrapper from './components/SettingsWrapper'
import 'remixicon/fonts/remixicon.css'
import './index.css'

const isSettingsWindow = window.location.search.includes('window=settings')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isSettingsWindow ? <SettingsWrapper /> : <App />}
  </React.StrictMode>,
)
