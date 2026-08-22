import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev server proxies the API so the browser sees one origin and no CORS.
    proxy: { '/api': { target: 'http://localhost:5174', changeOrigin: true } },
  },
})
