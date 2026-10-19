import { basename } from 'path'
import { createBackup } from '../utils/db'

export default defineEventHandler(() => {
  const backupPath = createBackup()

  if (!backupPath) {
    throw createError({ statusCode: 500, message: 'Backup failed' })
  }

  return { success: true, path: backupPath, name: basename(backupPath) }
})
