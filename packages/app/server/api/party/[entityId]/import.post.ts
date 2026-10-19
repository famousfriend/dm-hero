import { getDb } from '../../../utils/db'
import { getPartyMember, importDdbJson } from '../../../utils/party'
import { requirePartyMember } from '../../../utils/party-route'

// POST /api/party/:entityId/import - body: a saved D&D Beyond character JSON (fallback
// when the site can't be reached)
export default defineEventHandler(async (event) => {
  const { entityId } = requirePartyMember(event)
  const db = getDb()
  try {
    importDdbJson(db, entityId, await readBody(event))
  }
  catch (error) {
    throw createError({ statusCode: 400, message: error instanceof Error ? error.message : 'Import failed' })
  }
  return getPartyMember(db, entityId)
})
