import { getDb } from '../../../utils/db'
import { listManualLinks } from '../../../utils/codex'
import { requireLinkOwner } from '../../../utils/codex-route'

// GET /api/codex/links?ownerType=entity&ownerId=12
export default defineEventHandler((event) => {
  const { ownerType, ownerId } = requireLinkOwner(event, getQuery(event))
  return listManualLinks(getDb(), ownerType, ownerId)
})
