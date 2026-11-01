import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import SavedScans from './SavedScans.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SavedScans />
  </StrictMode>,
)
