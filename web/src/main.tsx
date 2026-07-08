import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Showcase } from './ui/Showcase'
import { Viewer } from './viewer/Viewer'
import { OpticsBench } from './optics/OpticsBench'
import './juice.css'

// The standalone shape/SDF viewer is the front door. The idle game is an easter egg at ?game; ?ui = the
// component-library gallery; ?optics = the thin-lens camera light-transport testbed. (?viewer falls through.)
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const root = params.has('game') ? <App /> : params.has('ui') ? <Showcase /> : params.has('optics') ? <OpticsBench /> : <Viewer />

createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
