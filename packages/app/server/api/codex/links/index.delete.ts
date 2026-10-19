import { getDb } from '../../../utils/db'
import { listManualLinks, removeManualLink } from '../../../utils/codex'
import { requireLinkOwner } from '../../../utils/codex-route'

// DELETE /api/codex/links?ownerType=entity&ownerId=12&uid=spell:fireball|phb -> the owner's links
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { ownerType, ownerId } = requireLinkOwner(event, query)
  if (typeof query.uid !== 'string' || !query.uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }
  const db = getDb()
  removeManualLink(db, ownerType, ownerId, query.uid)
  return listManualLinks(db, ownerType, ownerId)
})
