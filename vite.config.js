import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import geminiHintPlugin from './server/geminiPlugin.js'

export default defineConfig({
  plugins: [react(), geminiHintPlugin()],
  worker: { format: 'es' },
})
