import { basename } from 'path'
import { getDb, resolveBackupPath, restoreDatabaseFrom } from '../../utils/db'
import { runMigrations } from '../../utils/migrations'

// Replace the live database with one of the backups in the backup folder.
// The current state is backed up first, so this can be undone the same way.
export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { name?: string } | null
  const sourcePath = resolveBackupPath(body?.name ?? '')
  if (!sourcePath) {
    throw createError({ statusCode: 400, message: 'Unknown backup' })
  }

  let safetyBackup: string | null
  try {
    ({ safetyBackup } = restoreDatabaseFrom(sourcePath))
  }
  catch (error) {
    throw createError({ statusCode: 400, message: error instanceof Error ? error.message : String(error) })
  }

  // An older backup may predate later migrations
  await runMigrations(getDb())

  return { success: true, restored: basename(sourcePath), safetyBackup: safetyBackup ? basename(safetyBackup) : null }
})
