import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import './styles/app.css'

// Kill WebView2's default context menu (back / refresh / print / more tools)
// everywhere. Custom menus (tree nodes, tabs, quick access) bring their own
// onContextMenu handlers and still open; blank areas just do nothing.
document.addEventListener('contextmenu', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
