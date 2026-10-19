import { getBackupDir, listBackups, MAX_BACKUPS } from '../../utils/db'

export default defineEventHandler(() => {
  return { backups: listBackups(), directory: getBackupDir(), maxBackups: MAX_BACKUPS }
})
