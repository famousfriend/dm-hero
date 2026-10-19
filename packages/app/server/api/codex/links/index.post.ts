import { CODEX_UID_REGEX } from '../../../../types/codex'
import { getDb } from '../../../utils/db'
import { addManualLink, listManualLinks } from '../../../utils/codex'
import { requireLinkOwner } from '../../../utils/codex-route'

// POST /api/codex/links { ownerType, ownerId, uid } -> the owner's links
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const { ownerType, ownerId, campaignId } = requireLinkOwner(event, body)
  if (typeof body.uid !== 'string' || !CODEX_UID_REGEX.test(body.uid)) {
    throw createError({ statusCode: 400, message: 'Invalid reference' })
  }
  const db = getDb()
  addManualLink(db, campaignId, ownerType, ownerId, body.uid)
  return listManualLinks(db, ownerType, ownerId)
})
