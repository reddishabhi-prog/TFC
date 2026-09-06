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
        // Only the packages that are ALWAYS needed get an explicit chunk.
        // A blanket "everything else in node_modules -> vendor" rule looks
        // tidier but is a trap: jsPDF is reached only through a dynamic
        // import() inside the PDF export, but its own dependencies
        // (fflate, fast-png, @babel/runtime) don't have "jspdf" in their
        // path, so that kind of rule sweeps them into the eager bundle
        // anyway — nearly 3x'd vendor.js the first time this was tried.
        // Returning undefined for anything unlisted leaves Rollup's default
        // splitting in place, which correctly follows the dynamic-import
        // boundary for jsPDF and everything it pulls in.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/leaflet/')) return 'leaflet'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
