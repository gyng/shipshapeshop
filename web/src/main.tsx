import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Showcase } from './ui/Showcase'
import './juice.css'

// ?ui → the component-library gallery (dev only); otherwise the game.
const showcase = typeof location !== 'undefined' && new URLSearchParams(location.search).has('ui')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{showcase ? <Showcase /> : <App />}</StrictMode>,
)
