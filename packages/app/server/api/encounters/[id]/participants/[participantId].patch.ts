import type { CombatAction } from '~~/types/encounter'
import { getDb } from '../../../../utils/db'
import { getParticipant } from '../../../../utils/encounter-participants'
import { CombatActionError, applyCombatAction } from '../../../../utils/encounter-actions'

// PATCH { action: { type: 'damage' | 'heal' | 'tempHp' | 'deathSave', ... } }
//    or { current_hp?, max_hp?, temp_hp?, armor_class?, is_ko?, initiative?, notes?, sort_order? }
// HP, temp HP, AC, KO and death-save changes go through the action log (undo).
export default defineEventHandler(async (event) => {
  const db = getDb()
  const encounterId = Number(getRouterParam(event, 'id'))
  const participantId = Number(getRouterParam(event, 'participantId'))
  const body = (await readBody(event)) ?? {}

  if (!encounterId || !participantId) {
    throw createError({ statusCode: 400, message: 'Encounter ID and Participant ID are required' })
  }
  if (!getParticipant(db, encounterId, participantId)) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }

  const { initiative, current_hp, max_hp, temp_hp, armor_class, is_ko, notes, sort_order } = body

  // Turn-order and note fields: not part of the log
  db.prepare(`
    UPDATE encounter_participants
    SET
      initiative = COALESCE(?, initiative),
      notes = COALESCE(?, notes),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ? AND encounter_id = ?
  `).run(initiative ?? null, notes ?? null, sort_order ?? null, participantId, encounterId)

  const action: CombatAction | null = body.action
    ? body.action
    : [current_hp, max_hp, temp_hp, armor_class, is_ko].some(v => v !== undefined && v !== null)
        ? { type: 'set', fields: { current_hp, max_hp, temp_hp, armor_class, is_ko } }
        : null

  try {
    return action ? applyCombatAction(db, encounterId, participantId, action) : getParticipant(db, encounterId, participantId)
  }
  catch (error) {
    if (error instanceof CombatActionError) throw createError({ statusCode: 400, message: error.message })
    throw error
  }
})
