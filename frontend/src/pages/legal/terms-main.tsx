import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { LegalPage } from './LegalPage.tsx'
import markdown from '../../content/terms.md?raw'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LegalPage title="Terms of Service" markdown={markdown} />
  </StrictMode>,
)
