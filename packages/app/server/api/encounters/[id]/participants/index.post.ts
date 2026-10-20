import { getDb } from '../../../../utils/db'
import { addParticipants, listParticipants, type ParticipantInput } from '../../../../utils/encounter-participants'

// POST { entityIds: number[] } or { participants: [{ entityId | refUid, currentHp?, maxHp?, armorClass?, count? }] }
export default defineEventHandler(async (event) => {
  const db = getDb()
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  let inputs: ParticipantInput[]
  if (body.participants && Array.isArray(body.participants)) {
    inputs = body.participants
  }
  else if (body.entityIds && Array.isArray(body.entityIds)) {
    inputs = body.entityIds.map((id: number) => ({ entityId: id }))
  }
  else {
    throw createError({ statusCode: 400, message: 'participants or entityIds array is required' })
  }

  const encounter = db.prepare('SELECT id FROM encounters WHERE id = ? AND deleted_at IS NULL').get(encounterId)
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  addParticipants(db, encounterId, inputs)

  // Return updated encounter with participants
  const updatedEncounter = db.prepare(`
    SELECT id, campaign_id, session_id, name, status, round, current_turn_index,
      created_at, updated_at, finished_at
    FROM encounters
    WHERE id = ? AND deleted_at IS NULL
  `).get(encounterId) as Record<string, unknown>

  return { ...updatedEncounter, participants: listParticipants(db, encounterId) }
})
