import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { applyAppZoom, getStoredAppZoom } from './lib/app-zoom'
import './index.css'

applyAppZoom(getStoredAppZoom())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/dashboard">
      <App />
    </BrowserRouter>
  </StrictMode>,
)

applyAppZoom(getStoredAppZoom())
