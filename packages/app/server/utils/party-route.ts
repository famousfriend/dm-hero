import type { H3Event } from 'h3'
import { getDb } from './db'
import { getPartyMember } from './party'

/** The player entity a /api/party/:entityId route is about; 404 unless it is a player character. */
export function requirePartyMember(event: H3Event) {
  const entityId = Number(getRouterParam(event, 'entityId'))
  const member = entityId ? getPartyMember(getDb(), entityId) : null
  if (!member) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }
  return member
}
