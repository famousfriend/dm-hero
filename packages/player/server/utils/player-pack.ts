import type Database from 'better-sqlite3'
import { PlayerPackError, parsePlayerPack, type PackEntry, type PackImportResult, type PlayerPack } from '@dmcc/character-core'
import { RouteError } from './route-error'

type Table = 'places' | 'npcs' | 'quests'

interface CampaignPlan {
  id: number | null
  /** An existing campaign without a DM reference that gets linked to this DM's campaign */
  adopt: boolean
  name: string
  dmName: string
}

/**
 * Which campaign a pack goes into: the one already linked to the DM's
 * campaign, else the character's own campaign if it isn't linked to another
 * DM campaign yet (so a campaign the player typed in by hand is reused),
 * else a new one.
 */
function planCampaign(db: Database.Database, pack: PlayerPack, current: number | null): CampaignPlan {
  const linked = db.prepare('SELECT id, name, dm_name FROM campaigns WHERE dm_ref = ?').get(pack.campaign.ref) as
    { id: number, name: string, dm_name: string } | undefined
  if (linked) return { id: linked.id, adopt: false, name: linked.name, dmName: pack.campaign.dmName || linked.dm_name }
  if (current !== null) {
    const own = db.prepare('SELECT id, name, dm_name FROM campaigns WHERE id = ? AND dm_ref IS NULL').get(current) as
      { id: number, name: string, dm_name: string } | undefined
    if (own) return { id: own.id, adopt: true, name: own.name, dmName: pack.campaign.dmName || own.dm_name }
  }
  return { id: null, adopt: false, name: pack.campaign.name, dmName: pack.campaign.dmName }
}

interface ExistingRow {
  id: number
  name: string
  description: string
  place_id?: number | null
  status?: string
  reward?: string
}

function existing(db: Database.Database, table: Table, characterId: number, ref: string) {
  return db.prepare(`SELECT * FROM ${table} WHERE character_id = ? AND dm_ref = ?`).get(characterId, ref) as ExistingRow | undefined
}

/**
 * Preview (apply false) or import (apply true) a player pack for a character.
 * Name, description, status and reward of what the DM sent are the DM's and
 * get updated; the player's own notes are never touched. An empty description
 * in a newer pack (the DM left descriptions out) keeps the one already there.
 * Entries the DM no longer sends stay: the character still met them.
 */
export function importPlayerPack(db: Database.Database, characterId: number, input: unknown, apply: boolean): PackImportResult {
  let pack: PlayerPack
  try {
    pack = parsePlayerPack(input)
  }
  catch (error) {
    if (error instanceof PlayerPackError) throw new RouteError(400, error.message)
    throw error
  }
  const character = db.prepare('SELECT campaign_id FROM characters WHERE id = ?').get(characterId) as
    { campaign_id: number | null } | undefined
  if (!character) throw new RouteError(400, 'Unknown character')

  const zero = () => ({ added: 0, updated: 0, unchanged: 0 })
  const counts = { places: zero(), npcs: zero(), quests: zero() }

  const run = () => {
    const plan = planCampaign(db, pack, character.campaign_id)
    let campaignId = plan.id
    if (apply) {
      if (campaignId === null) {
        campaignId = Number(db.prepare('INSERT INTO campaigns (name, dm_name, dm_ref) VALUES (?, ?, ?)')
          .run(plan.name, plan.dmName, pack.campaign.ref).lastInsertRowid)
      }
      else {
        db.prepare('UPDATE campaigns SET dm_name = ?, dm_ref = ? WHERE id = ?').run(plan.dmName, pack.campaign.ref, campaignId)
      }
      db.prepare('UPDATE characters SET campaign_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(campaignId, characterId)
    }

    // Every entry: compare with what is there, then insert or update
    const upsert = (table: Table, item: PackEntry, extra: Record<string, unknown>) => {
      const row = existing(db, table, characterId, item.ref)
      const description = item.description || row?.description || ''
      const next = { name: item.name, description, ...extra }
      if (!row) {
        counts[table].added++
        if (!apply) return null
        const columns = Object.keys(next)
        const sourceColumn = table === 'quests' ? '' : ', source'
        const sourceValue = table === 'quests' ? '' : ', \'dm\''
        return Number(db.prepare(
          `INSERT INTO ${table} (character_id, dm_ref, ${columns.join(', ')}${sourceColumn}) VALUES (?, ?, ${columns.map(() => '?').join(', ')}${sourceValue})`,
        ).run(characterId, item.ref, ...Object.values(next)).lastInsertRowid)
      }
      const changed = Object.entries(next).some(([key, value]) => (row as unknown as Record<string, unknown>)[key] !== value)
      counts[table][changed ? 'updated' : 'unchanged']++
      if (apply && changed) {
        db.prepare(`UPDATE ${table} SET ${Object.keys(next).map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...Object.values(next), row.id)
      }
      return row.id
    }

    const placeIds = new Map<string, number | null>()
    for (const place of pack.places) placeIds.set(place.ref, upsert('places', place, {}))
    for (const npc of pack.npcs) {
      const row = existing(db, 'npcs', characterId, npc.ref)
      // Where they met: the DM's place when it is in this pack or an earlier one, else what the player set
      const dmPlace = npc.placeRef
        ? (placeIds.get(npc.placeRef) ?? existing(db, 'places', characterId, npc.placeRef)?.id ?? null)
        : null
      upsert('npcs', npc, { place_id: dmPlace ?? row?.place_id ?? null })
    }
    for (const quest of pack.quests) upsert('quests', quest, { status: quest.status, reward: quest.reward })

    return {
      applied: apply,
      campaign: { name: plan.name, dmName: plan.dmName, isNew: plan.id === null },
      forCharacter: pack.forCharacter,
      changesCampaign: character.campaign_id !== null && plan.id !== character.campaign_id,
      counts,
    }
  }
  return apply ? db.transaction(run)() : run()
}
