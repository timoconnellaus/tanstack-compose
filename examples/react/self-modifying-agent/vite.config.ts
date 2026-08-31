import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // `pnpm dev:ai` runs `@tanstack/compose-cloudflare`'s dev Worker beside
    // this server; its `/ai/chat/completions` route speaks the
    // OpenAI-compatible protocol over the Workers AI binding. The binding stays
    // in the Worker, so the page holds no **credential** — it is talking to its
    // own origin.
    proxy: { '/ai': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
})
