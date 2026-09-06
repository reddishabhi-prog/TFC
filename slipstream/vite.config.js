import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev server proxies the API so the browser sees one origin and no CORS.
    proxy: { '/api': { target: 'http://localhost:5174', changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      output: {
        // Leaflet is only ever imported by the two lazy-loaded ride screens,
        // so it would already end up out of the main chunk — pulling it into
        // its own named chunk just makes that explicit. React/react-dom
        // change far less often than the app's own code, so splitting them
        // out too means a normal feature deploy doesn't force everyone to
        // re-download the framework on top of what they've already cached.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('leaflet')) return 'leaflet'
          return 'vendor'
        },
      },
    },
  },
})
