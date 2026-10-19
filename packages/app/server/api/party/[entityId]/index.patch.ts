import { getDb } from '../../../utils/db'
import { getPartyMember, updatePartyMember } from '../../../utils/party'
import { requirePartyMember } from '../../../utils/party-route'
import { parseDdbCharacterId } from '../../../../types/party'

// PATCH /api/party/:entityId
// { ddbLink?: string | null, manual?: { field: value | null } } - null reverts a field to D&D Beyond
export default defineEventHandler(async (event) => {
  const { entityId } = requirePartyMember(event)
  const body = (await readBody(event)) as { ddbLink?: string | null, manual?: Record<string, unknown> } | null

  let ddbCharacterId: string | null | undefined
  if (body?.ddbLink !== undefined) {
    if (body.ddbLink === null || body.ddbLink.trim() === '') ddbCharacterId = null
    else {
      ddbCharacterId = parseDdbCharacterId(body.ddbLink)
      if (!ddbCharacterId) {
        throw createError({ statusCode: 400, message: 'Not a D&D Beyond character link' })
      }
    }
  }
  const manual = body?.manual && typeof body.manual === 'object' ? body.manual : undefined

  const db = getDb()
  updatePartyMember(db, entityId, { ddbCharacterId, manual })
  return getPartyMember(db, entityId)
})
