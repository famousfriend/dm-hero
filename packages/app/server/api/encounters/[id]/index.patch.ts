import { getDb } from '../../../utils/db'
import { listParticipants } from '../../../utils/encounter-participants'
import { listCombatLog, undoLastCombatAction } from '../../../utils/encounter-actions'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  // { undo: true }: take back the newest action-log entry, return the whole encounter
  if (body?.undo) {
    const encounter = db.prepare('SELECT * FROM encounters WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!encounter) throw createError({ statusCode: 404, message: 'Encounter not found' })
    const undone = undoLastCombatAction(db, Number(id))
    return { ...encounter, undone, participants: listParticipants(db, id), log: listCombatLog(db, Number(id)) }
  }

  const { name, status, session_id, round, current_turn_index, finished_at } = body

  db.prepare(
    `
    UPDATE encounters
    SET
      name = COALESCE(?, name),
      status = COALESCE(?, status),
      session_id = ?,
      round = COALESCE(?, round),
      current_turn_index = COALESCE(?, current_turn_index),
      finished_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `,
  ).run(
    name,
    status,
    session_id,
    round,
    current_turn_index,
    finished_at,
    id,
  )

  const encounter = db
    .prepare(
      `
    SELECT * FROM encounters WHERE id = ? AND deleted_at IS NULL
  `,
    )
    .get(id)

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: 'Encounter not found',
    })
  }

  // Restarting a fight starts a fresh action log (old entries can't be undone any more)
  if (status === 'setup') {
    db.prepare('DELETE FROM encounter_log WHERE encounter_id = ?').run(id)
    return { ...encounter, log: [] }
  }

  return encounter
})
