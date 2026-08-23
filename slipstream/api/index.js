// Vercel serverless entry. Every request under /api is routed here (see
// vercel.json rewrites) and handled by the same Express app that runs
// locally — only the transport differs (a function invocation instead of a
// listening socket).
import { app } from '../server/app.js'
import { migrate } from '../server/lib/db.js'

// A warm container reuses this module between invocations, so the migration
// only actually runs once per container rather than on every request.
let migrated = null
function ensureMigrated() {
  if (!migrated) migrated = migrate().catch((err) => { migrated = null; throw err })
  return migrated
}

export default async function handler(req, res) {
  await ensureMigrated()
  app(req, res)
}
