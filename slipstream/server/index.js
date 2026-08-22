import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { rideRoutes } from './routes/rides.js'
import { groupRoutes } from './routes/groups.js'
import { chatRoutes, garageRoutes, notificationRoutes } from './routes/misc.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT) || 5174

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true, at: Date.now() }))
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/rides', rideRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/garage', garageRoutes)
app.use('/api/notifications', notificationRoutes)

app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint' }))

// In production the API also serves the built SPA, so one process runs the
// whole app. In dev, Vite serves the frontend and proxies /api here.
const dist = resolve(__dirname, '../dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

// Express 4 identifies error handlers by arity — `next` must stay in the
// signature even though it is unused, or thrown errors become 404s.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[slipstream]', err)
  res.status(500).json({ error: 'Something went wrong on our side' })
})

app.listen(PORT, () => {
  console.log(`[slipstream] API listening on http://localhost:${PORT}`)
})
