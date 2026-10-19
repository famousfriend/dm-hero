import { getDb } from '../../../utils/db'
import { getPartyMember, refreshPartyMember } from '../../../utils/party'
import { requirePartyMember } from '../../../utils/party-route'

// POST /api/party/:entityId/refresh - fetch this player's sheet now
export default defineEventHandler(async (event) => {
  const { entityId } = requirePartyMember(event)
  const db = getDb()
  await refreshPartyMember(db, entityId, { force: true })
  return getPartyMember(db, entityId)
})
