import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Showcase } from './ui/Showcase'
import { Viewer } from './viewer/Viewer'
import './juice.css'

// ?viewer → the standalone shape/SDF viewer (no game core); ?ui → the component-library gallery; else the game.
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const root = params.has('viewer') ? <Viewer /> : params.has('ui') ? <Showcase /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
