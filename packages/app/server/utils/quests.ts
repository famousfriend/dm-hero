import type Database from 'better-sqlite3'
import {
  CONTINUITY_KINDS,
  QUEST_STATUSES,
  type ContinuityInput,
  type ContinuityItem,
  type ContinuityKind,
  type LastMet,
  type LinkedEntity,
  type Quest,
  type QuestInput,
  type QuestStatus,
} from '../../types/quests'

/** Relation type that ties a quest to the NPCs, places ... involved in it */
export const QUEST_INVOLVES = 'quest_involves'

/** Entity types that can be linked to quests and continuity items */
export const LINKABLE_TYPES = ['NPC', 'Location', 'Item', 'Faction', 'Lore', 'Player', 'Quest'] as const

export class QuestInputError extends Error {}

interface QuestMetadata {
  status?: QuestStatus
  reward?: string | null
  giver_id?: number | null
}

const parseJson = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  }
  catch {
    return fallback
  }
}

function questTypeId(db: Database.Database): number {
  const row = db.prepare('SELECT id FROM entity_types WHERE name = \'Quest\'').get() as { id: number } | undefined
  if (!row) throw new Error('Quest entity type missing')
  return row.id
}

/** Active entities of a campaign by id, limited to linkable types. Unknown ids are dropped. */
function loadLinked(db: Database.Database, campaignId: number, ids: number[]): Map<number, LinkedEntity> {
  const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))]
  if (!unique.length) return new Map()
  const rows = db
    .prepare(
      `SELECT e.id, e.name, t.name AS type FROM entities e JOIN entity_types t ON t.id = e.type_id
       WHERE e.campaign_id = ? AND e.deleted_at IS NULL AND e.id IN (${unique.map(() => '?').join(',')})`,
    )
    .all(campaignId, ...unique) as LinkedEntity[]
  return new Map(rows.map(r => [r.id, r]))
}

/** Everything a quest or continuity item can point at, for pickers. */
export function listLinkable(db: Database.Database, campaignId: number): LinkedEntity[] {
  return db
    .prepare(
      `SELECT e.id, e.name, t.name AS type FROM entities e JOIN entity_types t ON t.id = e.type_id
       WHERE e.campaign_id = ? AND e.deleted_at IS NULL
         AND t.name IN (${LINKABLE_TYPES.map(() => '?').join(',')})
       ORDER BY t.name, e.name`,
    )
    .all(campaignId, ...LINKABLE_TYPES) as LinkedEntity[]
}

// ============================================================================
// Quests
// ============================================================================

interface QuestRow {
  id: number
  campaign_id: number
  name: string
  description: string | null
  metadata: string | null
  updated_at: string
  archived_at: string | null
}

function toQuests(db: Database.Database, rows: QuestRow[]): Quest[] {
  if (!rows.length) return []
  const campaignId = rows[0]!.campaign_id
  const involvedRows = db
    .prepare(
      `SELECT r.from_entity_id AS quest_id, e.id, e.name, t.name AS type
       FROM entity_relations r
       JOIN entities e ON e.id = r.to_entity_id AND e.deleted_at IS NULL
       JOIN entity_types t ON t.id = e.type_id
       WHERE r.relation_type = ? AND r.from_entity_id IN (${rows.map(() => '?').join(',')})
       ORDER BY t.name, e.name`,
    )
    .all(QUEST_INVOLVES, ...rows.map(r => r.id)) as Array<LinkedEntity & { quest_id: number }>
  const metas = rows.map(r => parseJson<QuestMetadata>(r.metadata, {}))
  const givers = loadLinked(db, campaignId, metas.map(m => Number(m.giver_id)))

  return rows.map((row, i) => {
    const meta = metas[i]!
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: QUEST_STATUSES.includes(meta.status as QuestStatus) ? meta.status! : 'open',
      reward: meta.reward ?? null,
      giver: givers.get(Number(meta.giver_id)) ?? null,
      involved: involvedRows.filter(r => r.quest_id === row.id).map(({ id, name, type }) => ({ id, name, type })),
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    }
  })
}

const QUEST_SELECT = `
  SELECT e.id, e.campaign_id, e.name, e.description, e.metadata, e.updated_at, e.archived_at
  FROM entities e JOIN entity_types t ON t.id = e.type_id AND t.name = 'Quest'
`

export function listQuests(db: Database.Database, campaignId: number): Quest[] {
  const rows = db
    .prepare(`${QUEST_SELECT} WHERE e.campaign_id = ? AND e.deleted_at IS NULL ORDER BY e.updated_at DESC, e.id DESC`)
    .all(campaignId) as QuestRow[]
  return toQuests(db, rows)
}

export function getQuest(db: Database.Database, id: number): (Quest & { campaignId: number }) | null {
  const row = db.prepare(`${QUEST_SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`).get(id) as QuestRow | undefined
  return row ? { ...toQuests(db, [row])[0]!, campaignId: row.campaign_id } : null
}

function cleanText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim().slice(0, max)
  return text || null
}

function writeInvolved(db: Database.Database, campaignId: number, questId: number, ids: number[]) {
  const linked = loadLinked(db, campaignId, ids)
  linked.delete(questId)
  db.prepare('DELETE FROM entity_relations WHERE from_entity_id = ? AND relation_type = ?').run(questId, QUEST_INVOLVES)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO entity_relations (from_entity_id, to_entity_id, relation_type) VALUES (?, ?, ?)',
  )
  for (const id of linked.keys()) insert.run(questId, id, QUEST_INVOLVES)
}

export function createQuest(db: Database.Database, campaignId: number, input: QuestInput): Quest {
  const name = cleanText(input.name, 200)
  if (!name) throw new QuestInputError('Name is required')
  const status = input.status ?? 'open'
  if (!QUEST_STATUSES.includes(status)) throw new QuestInputError('Unknown status')
  const giverId = input.giverId && loadLinked(db, campaignId, [input.giverId]).has(input.giverId) ? input.giverId : null
  const meta: QuestMetadata = { status, reward: cleanText(input.reward, 500), giver_id: giverId }
  // One INSERT with everything: updating the new row again inside this
  // transaction made the external-content entities_fts index report corruption
  return db.transaction(() => {
    const id = Number(
      db
        .prepare('INSERT INTO entities (type_id, campaign_id, name, description, metadata) VALUES (?, ?, ?, ?, ?)')
        .run(questTypeId(db), campaignId, name, cleanText(input.description, 20000), JSON.stringify(meta))
        .lastInsertRowid,
    )
    writeInvolved(db, campaignId, id, input.involvedIds ?? [])
    return getQuest(db, id)!
  })()
}

export function updateQuest(db: Database.Database, id: number, input: QuestInput): Quest {
  const quest = getQuest(db, id)
  if (!quest) throw new QuestInputError('Quest not found')
  if (input.status !== undefined && !QUEST_STATUSES.includes(input.status)) throw new QuestInputError('Unknown status')

  const row = db.prepare('SELECT metadata FROM entities WHERE id = ?').get(id) as { metadata: string | null }
  const meta = parseJson<QuestMetadata>(row.metadata, {})
  if (input.status !== undefined) meta.status = input.status
  if (input.reward !== undefined) meta.reward = cleanText(input.reward, 500)
  if (input.giverId !== undefined) {
    meta.giver_id = input.giverId && loadLinked(db, quest.campaignId, [input.giverId]).has(input.giverId) ? input.giverId : null
  }

  const name = input.name !== undefined ? cleanText(input.name, 200) : quest.name
  if (!name) throw new QuestInputError('Name is required')
  const description = input.description !== undefined ? cleanText(input.description, 20000) : quest.description

  db.transaction(() => {
    db.prepare(
      'UPDATE entities SET name = ?, description = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(name, description, JSON.stringify(meta), id)
    if (input.involvedIds !== undefined) writeInvolved(db, quest.campaignId, id, input.involvedIds)
  })()
  return getQuest(db, id)!
}

export function deleteQuest(db: Database.Database, id: number): boolean {
  const result = db
    .prepare(
      `UPDATE entities SET deleted_at = CURRENT_TIMESTAMP
       WHERE id = ? AND deleted_at IS NULL AND type_id = (SELECT id FROM entity_types WHERE name = 'Quest')`,
    )
    .run(id)
  return result.changes > 0
}

// ============================================================================
// Continuity items
// ============================================================================

interface ItemRow {
  id: number
  campaign_id: number
  session_id: number | null
  session_title: string | null
  kind: string
  text: string
  status: string
  next_session: number
  created_at: string
  resolved_at: string | null
}

const ITEM_SELECT = `
  SELECT c.id, c.campaign_id, c.session_id, s.title AS session_title, c.kind, c.text, c.status,
         c.next_session, c.created_at, c.resolved_at
  FROM continuity_items c LEFT JOIN sessions s ON s.id = c.session_id AND s.deleted_at IS NULL
`

function toItems(db: Database.Database, rows: ItemRow[]): ContinuityItem[] {
  if (!rows.length) return []
  const links = db
    .prepare(
      `SELECT l.item_id, e.id, e.name, t.name AS type
       FROM continuity_item_entities l
       JOIN entities e ON e.id = l.entity_id AND e.deleted_at IS NULL
       JOIN entity_types t ON t.id = e.type_id
       WHERE l.item_id IN (${rows.map(() => '?').join(',')})
       ORDER BY e.name`,
    )
    .all(...rows.map(r => r.id)) as Array<LinkedEntity & { item_id: number }>
  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_title === null ? null : row.session_id,
    sessionTitle: row.session_title,
    kind: (CONTINUITY_KINDS.includes(row.kind as ContinuityKind) ? row.kind : 'thread') as ContinuityKind,
    text: row.text,
    status: row.status === 'resolved' ? 'resolved' : 'open',
    nextSession: row.next_session === 1,
    entities: links.filter(l => l.item_id === row.id).map(({ id, name, type }) => ({ id, name, type })),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }))
}

export function listContinuity(
  db: Database.Database,
  campaignId: number,
  filter: { sessionId?: number, status?: 'open' | 'resolved', entityId?: number } = {},
): ContinuityItem[] {
  const where = ['c.campaign_id = ?']
  const params: unknown[] = [campaignId]
  if (filter.sessionId !== undefined) {
    where.push('c.session_id = ?')
    params.push(filter.sessionId)
  }
  if (filter.status) {
    where.push('c.status = ?')
    params.push(filter.status)
  }
  if (filter.entityId !== undefined) {
    where.push('c.id IN (SELECT item_id FROM continuity_item_entities WHERE entity_id = ?)')
    params.push(filter.entityId)
  }
  const rows = db
    .prepare(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.next_session DESC, c.created_at DESC, c.id DESC`)
    .all(...params) as ItemRow[]
  return toItems(db, rows)
}

export function getContinuityItem(db: Database.Database, id: number): (ContinuityItem & { campaignId: number }) | null {
  const row = db.prepare(`${ITEM_SELECT} WHERE c.id = ?`).get(id) as ItemRow | undefined
  return row ? { ...toItems(db, [row])[0]!, campaignId: row.campaign_id } : null
}

function writeItemEntities(db: Database.Database, campaignId: number, itemId: number, ids: number[]) {
  const linked = loadLinked(db, campaignId, ids)
  db.prepare('DELETE FROM continuity_item_entities WHERE item_id = ?').run(itemId)
  const insert = db.prepare('INSERT INTO continuity_item_entities (item_id, entity_id) VALUES (?, ?)')
  for (const id of linked.keys()) insert.run(itemId, id)
}

function sessionInCampaign(db: Database.Database, campaignId: number, sessionId: number | null | undefined): number | null {
  if (!sessionId) return null
  const row = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND campaign_id = ? AND deleted_at IS NULL')
    .get(sessionId, campaignId) as { id: number } | undefined
  if (!row) throw new QuestInputError('Session not found')
  return row.id
}

export function createContinuityItem(db: Database.Database, campaignId: number, input: ContinuityInput): ContinuityItem {
  const text = cleanText(input.text, 2000)
  if (!text) throw new QuestInputError('Text is required')
  const kind = input.kind ?? 'thread'
  if (!CONTINUITY_KINDS.includes(kind)) throw new QuestInputError('Unknown kind')
  const sessionId = sessionInCampaign(db, campaignId, input.sessionId)
  return db.transaction(() => {
    const id = Number(
      db
        .prepare(
          'INSERT INTO continuity_items (campaign_id, session_id, kind, text, next_session) VALUES (?, ?, ?, ?, ?)',
        )
        .run(campaignId, sessionId, kind, text, input.nextSession ? 1 : 0).lastInsertRowid,
    )
    writeItemEntities(db, campaignId, id, input.entityIds ?? [])
    return getContinuityItem(db, id)!
  })()
}

export function updateContinuityItem(db: Database.Database, id: number, input: ContinuityInput): ContinuityItem {
  const item = getContinuityItem(db, id)
  if (!item) throw new QuestInputError('Item not found')
  const sets: string[] = []
  const params: unknown[] = []
  if (input.text !== undefined) {
    const text = cleanText(input.text, 2000)
    if (!text) throw new QuestInputError('Text is required')
    sets.push('text = ?')
    params.push(text)
  }
  if (input.kind !== undefined) {
    if (!CONTINUITY_KINDS.includes(input.kind)) throw new QuestInputError('Unknown kind')
    sets.push('kind = ?')
    params.push(input.kind)
  }
  if (input.status !== undefined) {
    if (input.status !== 'open' && input.status !== 'resolved') throw new QuestInputError('Unknown status')
    sets.push('status = ?', `resolved_at = ${input.status === 'resolved' ? 'CURRENT_TIMESTAMP' : 'NULL'}`)
    params.push(input.status)
    // A resolved item no longer needs bringing up
    if (input.status === 'resolved' && input.nextSession === undefined) sets.push('next_session = 0')
  }
  if (input.nextSession !== undefined) {
    sets.push('next_session = ?')
    params.push(input.nextSession ? 1 : 0)
  }
  if (input.sessionId !== undefined) {
    sets.push('session_id = ?')
    params.push(sessionInCampaign(db, item.campaignId, input.sessionId))
  }
  db.transaction(() => {
    if (sets.length) {
      db.prepare(`UPDATE continuity_items SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        ...params,
        id,
      )
    }
    if (input.entityIds !== undefined) writeItemEntities(db, item.campaignId, id, input.entityIds)
  })()
  return getContinuityItem(db, id)!
}

export function deleteContinuityItem(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM continuity_items WHERE id = ?').run(id).changes > 0
}

// ============================================================================
// "Last met": the latest session each NPC was mentioned in
// ============================================================================

export function listLastMet(db: Database.Database, campaignId: number, type = 'NPC'): LastMet[] {
  const sessions = db
    .prepare(
      `SELECT id, title, session_number, date FROM sessions
       WHERE campaign_id = ? AND deleted_at IS NULL
       ORDER BY COALESCE(date, '') DESC, COALESCE(session_number, 0) DESC, id DESC`,
    )
    .all(campaignId) as Array<{ id: number, title: string, session_number: number | null, date: string | null }>
  const order = new Map(sessions.map((s, i) => [s.id, i]))

  const mentions = db
    .prepare(
      `SELECT m.session_id, e.id, e.name, t.name AS type
       FROM session_mentions m
       JOIN entities e ON e.id = m.entity_id AND e.deleted_at IS NULL AND e.campaign_id = ?
       JOIN entity_types t ON t.id = e.type_id AND t.name = ?`,
    )
    .all(campaignId, type) as Array<LinkedEntity & { session_id: number }>

  const latest = new Map<number, { entity: LinkedEntity, rank: number }>()
  for (const m of mentions) {
    const rank = order.get(m.session_id)
    if (rank === undefined) continue
    const current = latest.get(m.id)
    if (!current || rank < current.rank) latest.set(m.id, { entity: { id: m.id, name: m.name, type: m.type }, rank })
  }

  return [...latest.values()]
    .sort((a, b) => b.rank - a.rank || a.entity.name.localeCompare(b.entity.name))
    .map(({ entity, rank }) => {
      const s = sessions[rank]!
      return {
        entity,
        sessionId: s.id,
        sessionTitle: s.title,
        sessionNumber: s.session_number,
        sessionDate: s.date,
        sessionsAgo: rank,
      }
    })
}
