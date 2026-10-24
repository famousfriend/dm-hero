import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { PLAYER_PACK_FORMAT, PLAYER_PACK_VERSION, type PackQuestStatus, type PlayerPack } from '@dmcc/character-core'
import { listQuests } from './quests'
import { readSetting, writeSetting } from './settings'

/*
 * Player pack export (Player Companion): the campaign info the DM chose to
 * hand to the players, as one file. No server involved.
 */

export class PlayerPackInputError extends Error {}

export interface PlayerPackRequest {
  npcIds?: unknown
  placeIds?: unknown
  questIds?: unknown
  /** Descriptions can hold DM secrets, so they are only sent when asked for */
  includeDescriptions?: unknown
  forCharacter?: unknown
  dmName?: unknown
}

/** Random id of this DM install, so refs from two DMs never collide in a player's app */
function installId(db: Database.Database): string {
  let id = readSetting(db, 'player_pack_install_id')
  if (!id) {
    id = randomBytes(8).toString('hex')
    writeSetting(db, 'player_pack_install_id', id)
  }
  return id
}

const ids = (value: unknown): number[] =>
  Array.isArray(value) ? [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n > 0))] : []

interface EntityRow {
  id: number
  name: string
  description: string | null
  type: string
}

/** {{npc:12}} mentions become the entity's name; other tokens ({{codex:...}}) their readable part */
function plainText(db: Database.Database, text: string | null): string {
  if (!text) return ''
  return text.replace(/\{\{(\w+):([^}]+)\}\}/g, (_, _kind: string, ref: string) => {
    if (/^\d+$/.test(ref)) {
      const row = db.prepare('SELECT name FROM entities WHERE id = ?').get(Number(ref)) as { name: string } | undefined
      return row?.name ?? ''
    }
    const last = ref.split(/[:/]/).pop() ?? ref
    return last.replace(/[-_]/g, ' ')
  }).trim()
}

export function buildPlayerPack(db: Database.Database, campaignId: number, input: PlayerPackRequest): PlayerPack {
  const campaign = db.prepare('SELECT id, name FROM campaigns WHERE id = ? AND deleted_at IS NULL').get(campaignId) as { id: number, name: string } | undefined
  if (!campaign) throw new PlayerPackInputError('Campaign not found')
  const install = installId(db)
  const ref = (kind: string, id: number) => `${install}:${kind}:${id}`
  const withDescriptions = input.includeDescriptions === true

  const load = (wanted: number[], type: string): EntityRow[] => {
    if (!wanted.length) return []
    return db.prepare(
      `SELECT e.id, e.name, e.description, t.name AS type FROM entities e JOIN entity_types t ON t.id = e.type_id
       WHERE e.campaign_id = ? AND e.deleted_at IS NULL AND t.name = ? AND e.id IN (${wanted.map(() => '?').join(',')})
       ORDER BY e.name`,
    ).all(campaignId, type, ...wanted) as EntityRow[]
  }

  const places = load(ids(input.placeIds), 'Location')
  const npcs = load(ids(input.npcIds), 'NPC')
  const placeIds = new Set(places.map(p => p.id))

  // Where the party met an NPC: an exported place the NPC is linked to, either direction
  const placeOf = (npcId: number): number | null => {
    const rows = db.prepare(
      'SELECT from_entity_id AS a, to_entity_id AS b FROM entity_relations WHERE from_entity_id = ? OR to_entity_id = ?',
    ).all(npcId, npcId) as { a: number, b: number }[]
    for (const { a, b } of rows) {
      const other = a === npcId ? b : a
      if (placeIds.has(other)) return other
    }
    return null
  }

  const wantedQuests = new Set(ids(input.questIds))
  const quests = wantedQuests.size ? listQuests(db, campaignId).filter(q => wantedQuests.has(q.id)) : []

  return {
    format: PLAYER_PACK_FORMAT,
    version: PLAYER_PACK_VERSION,
    exportedAt: new Date().toISOString(),
    campaign: {
      ref: `${install}:campaign:${campaign.id}`,
      name: campaign.name,
      dmName: typeof input.dmName === 'string' ? input.dmName.trim().slice(0, 200) : '',
    },
    forCharacter: typeof input.forCharacter === 'string' && input.forCharacter.trim() ? input.forCharacter.trim().slice(0, 200) : null,
    places: places.map(p => ({ ref: ref('location', p.id), name: p.name, description: withDescriptions ? plainText(db, p.description) : '' })),
    npcs: npcs.map((n) => {
      const placeId = placeOf(n.id)
      return {
        ref: ref('npc', n.id),
        name: n.name,
        description: withDescriptions ? plainText(db, n.description) : '',
        placeRef: placeId ? ref('location', placeId) : null,
      }
    }),
    quests: quests.map(q => ({
      ref: ref('quest', q.id),
      name: q.name,
      description: withDescriptions ? plainText(db, q.description) : '',
      status: q.status as PackQuestStatus,
      reward: q.reward ?? '',
    })),
  }
}
