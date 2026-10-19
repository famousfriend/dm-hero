import { getDb } from '../../utils/db'
import { getCodexEntry } from '../../utils/codex'

// GET /api/codex/entry?uid=spell:fireball|phb
export default defineEventHandler((event) => {
  const { uid } = getQuery(event)
  if (typeof uid !== 'string' || !uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }
  const entry = getCodexEntry(getDb(), uid)
  if (!entry) {
    throw createError({ statusCode: 404, message: 'Reference not found' })
  }
  return entry
})
