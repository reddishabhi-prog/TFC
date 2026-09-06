// Must be imported before any router: it patches Express 4's router methods
// so a rejected promise inside an async handler reaches the error middleware
// below instead of hanging the request forever (Express 4 has no native
// async-error handling; that only arrived in Express 5).
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { rideRoutes } from './routes/rides.js'
import { groupRoutes } from './routes/groups.js'
import { chatRoutes, garageRoutes, notificationRoutes, pushRoutes } from './routes/misc.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const app = express()

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true, at: Date.now() }))

// Which configuration actually reached this deployment, and which environment
// it thinks it is. Presence booleans only — never values — so a missing or
// mis-scoped variable can be diagnosed from the running app instead of by
// reading the dashboard and hoping the two agree.
app.get('/api/health/config', (_req, res) => {
  const names = [
    'DATABASE_URL', 'JWT_SECRET', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'SMS_PROVIDER_URL',
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
  ]
  res.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    present: Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])])),
  })
})
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/rides', rideRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/garage', garageRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/push', pushRoutes)

app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint' }))

// On Vercel, static files under dist/ are served by the platform itself, not
// this function — only requests under /api ever reach it. Locally (and in
// the single-process `npm start`), this process serves both.
const dist = resolve(__dirname, '../dist')
if (!process.env.VERCEL && existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[slipstream]', err)
  res.status(500).json({ error: 'Something went wrong on our side' })
})
