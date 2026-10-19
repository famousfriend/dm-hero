import { getDb } from '../utils/db'
import { runMigrations } from '../utils/migrations'
import { seedCodex } from '../utils/codex'

export default defineNitroPlugin(async () => {
  console.log('🗄️  Initializing database...')

  const db = getDb()

  // Run migrations
  await runMigrations(db)

  // Bundled reference data (SRD 5.1); no-op when already up to date
  seedCodex(db)

  console.log('✅ Database ready')
})
