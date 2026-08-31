import { createRoot } from 'react-dom/client'
import { ComposeProvider, Slot } from '@tanstack/react-compose'
import { createAppClient } from './client'
import { rootSlot } from './slots'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <ComposeProvider client={createAppClient()}>
    <Slot of={rootSlot} />
  </ComposeProvider>,
)
