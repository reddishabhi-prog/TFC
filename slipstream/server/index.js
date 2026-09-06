import { app } from './app.js'
import { migrate } from './lib/db.js'

const PORT = Number(process.env.PORT) || 5174

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[slipstream] API listening on http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('[slipstream] migration failed, refusing to start:', err)
    process.exit(1)
  })
