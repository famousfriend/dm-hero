import type Database from 'better-sqlite3'
import { addResources, listResources, parseMonsterResources } from './encounter-resources'

/**
 * Encounter participants: campaign entities (NPCs, players ...) or monsters
 * from the reference library (Codex, `ref_uid`), which have no entity.
 */

export interface ParticipantInput {
  entityId?: number
  /** Codex monster, e.g. "monster:goblin|mm" */
  refUid?: string
  currentHp?: number
  maxHp?: number
  armorClass?: number | null
  /** Copies to add (monsters), 1-20 */
  count?: number
}

interface MonsterData {
  hp?: number
  ac?: number
}

const PARTICIPANT_COLUMNS = `
  ep.id, ep.encounter_id, ep.entity_id, ep.ref_uid, ep.display_name, ep.duplicate_index,
  ep.initiative, ep.current_hp, ep.max_hp, ep.temp_hp, ep.armor_class, ep.death_save_successes, ep.death_save_failures,
  ep.sort_order, ep.is_ko, ep.notes,
  COALESCE(et.name, CASE WHEN ep.ref_uid IS NOT NULL THEN 'Monster' END) as entity_type,
  e.image_url as entity_image
FROM encounter_participants ep
LEFT JOIN entities e ON e.id = ep.entity_id
LEFT JOIN entity_types et ON et.id = e.type_id`

export function listParticipants(db: Database.Database, encounterId: number | string) {
  const participants = db
    .prepare(`SELECT ${PARTICIPANT_COLUMNS} WHERE ep.encounter_id = ? ORDER BY ep.sort_order ASC`)
    .all(encounterId) as Record<string, unknown>[]
  for (const p of participants) attachDetails(db, p)
  return participants
}

/** Effects and limited-use abilities belong to the participant in every response */
function attachDetails(db: Database.Database, participant: Record<string, unknown>) {
  participant.effects = db.prepare('SELECT * FROM encounter_effects WHERE participant_id = ?').all(participant.id)
  participant.resources = listResources(db, participant.id as number)
}

export function getParticipant(db: Database.Database, encounterId: number | string, participantId: number | string) {
  const participant = db
    .prepare(`SELECT ${PARTICIPANT_COLUMNS} WHERE ep.id = ? AND ep.encounter_id = ?`)
    .get(participantId, encounterId) as Record<string, unknown> | undefined
  if (participant) attachDetails(db, participant)
  return participant
}

/** Adds entities and/or Codex monsters at the end of the turn order; unknown ones are skipped. */
export function addParticipants(db: Database.Database, encounterId: number | string, inputs: ParticipantInput[]) {
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM encounter_participants WHERE encounter_id = ?')
    .get(encounterId) as { max_order: number }
  let sortOrder = maxOrder.max_order + 1

  const insert = db.prepare(`
    INSERT INTO encounter_participants
      (encounter_id, entity_id, ref_uid, display_name, duplicate_index, current_hp, max_hp, armor_class, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const entityStmt = db.prepare('SELECT id, name FROM entities WHERE id = ? AND deleted_at IS NULL')
  const monsterStmt = db.prepare(
    'SELECT ref_uid, name, data_json, body_md FROM ref_entries WHERE ref_uid = ? AND kind = \'monster\' AND deleted_at IS NULL',
  )
  const entityDupes = db.prepare('SELECT COUNT(*) as cnt FROM encounter_participants WHERE encounter_id = ? AND entity_id = ?')
  const monsterDupes = db.prepare('SELECT COUNT(*) as cnt FROM encounter_participants WHERE encounter_id = ? AND ref_uid = ?')
  const optionalNumber = (value: unknown) => (value === undefined || value === null || value === '' ? null : Number(value))

  db.transaction(() => {
    for (const input of inputs) {
      if (input.refUid) {
        const monster = monsterStmt.get(input.refUid) as { ref_uid: string, name: string, data_json: string | null, body_md: string | null } | undefined
        if (!monster) continue
        let data: MonsterData = {}
        try {
          data = JSON.parse(monster.data_json ?? '{}')
        }
        catch {
          // no stats: HP/AC stay empty
        }
        const maxHp = input.maxHp ?? data.hp ?? 0
        const armorClass = optionalNumber(input.armorClass) ?? data.ac ?? null
        const count = Math.min(20, Math.max(1, Math.trunc(input.count ?? 1)))
        // Recharge abilities, X/Day uses and legendary actions from the stat block
        const resources = parseMonsterResources(monster.body_md)
        for (let i = 0; i < count; i++) {
          const { cnt } = monsterDupes.get(encounterId, monster.ref_uid) as { cnt: number }
          const { lastInsertRowid } = insert.run(encounterId, null, monster.ref_uid, monster.name, cnt, input.currentHp ?? maxHp, maxHp, armorClass, sortOrder++)
          addResources(db, lastInsertRowid, resources)
        }
      }
      else if (input.entityId) {
        const entity = entityStmt.get(input.entityId) as { id: number, name: string } | undefined
        if (!entity) continue
        const { cnt } = entityDupes.get(encounterId, entity.id) as { cnt: number }
        insert.run(
          encounterId,
          entity.id,
          null,
          entity.name,
          cnt,
          input.currentHp ?? 0,
          input.maxHp ?? 0,
          optionalNumber(input.armorClass),
          sortOrder++,
        )
      }
    }
  })()
}
