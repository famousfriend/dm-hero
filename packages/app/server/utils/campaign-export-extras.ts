import type Database from 'better-sqlite3'
import type { CampaignExportManifest, ExportCampaignEdit, ExportContinuityItem, ExportPartyStatus } from '../../types/export'
import { CONTINUITY_KINDS } from '../../types/quests'

/*
 * DM Command Center tables in the campaign export (.dmhero): the party view,
 * continuity items and the campaign's rules edits. Kept out of the big export
 * and import routes; both call in here with their id maps.
 *
 * Partial exports (a few entities shared with someone) only carry the party
 * rows of exported players - continuity and rules edits can mention anything,
 * so they travel with full exports only.
 */

const ENTITY_LINK = /\{\{(npc|location|item|faction|lore|player|quest|session):(entity:\d+)\}\}/g

interface ExportContext {
  mode: 'full' | 'partial'
  /** entity id -> export id ("entity:3") */
  entities: Map<number, string>
  /** session id -> export id */
  sessions: Map<number, string>
  /** {{npc:12}} -> {{npc:entity:3}} */
  transformLinks: (text: string | null | undefined) => string | undefined
}

export function exportCampaignExtras(db: Database.Database, campaignId: number, ctx: ExportContext) {
  const partyStatus: ExportPartyStatus[] = []
  const rows = db.prepare(`
    SELECT p.entity_id, p.ddb_character_id, p.ddb_stats_json, p.ddb_explain_json, p.ddb_fetched_at, p.manual_json
    FROM party_status p JOIN entities e ON e.id = p.entity_id
    WHERE e.campaign_id = ?
  `).all(campaignId) as Array<{ entity_id: number, ddb_character_id: string | null, ddb_stats_json: string | null, ddb_explain_json: string | null, ddb_fetched_at: string | null, manual_json: string }>
  for (const row of rows) {
    const entity = ctx.entities.get(row.entity_id)
    if (!entity) continue
    partyStatus.push({
      entity,
      ddbCharacterId: row.ddb_character_id ?? undefined,
      ddbStatsJson: row.ddb_stats_json ?? undefined,
      ddbExplainJson: row.ddb_explain_json ?? undefined,
      ddbFetchedAt: row.ddb_fetched_at ?? undefined,
      manualJson: row.manual_json || '{}',
    })
  }

  const continuity: ExportContinuityItem[] = []
  const campaignEdits: ExportCampaignEdit[] = []
  if (ctx.mode === 'full') {
    const items = db.prepare(`
      SELECT id, session_id, kind, text, status, next_session, created_at, resolved_at
      FROM continuity_items WHERE campaign_id = ? ORDER BY id
    `).all(campaignId) as Array<{ id: number, session_id: number | null, kind: string, text: string, status: string, next_session: number, created_at: string, resolved_at: string | null }>
    const linked = db.prepare('SELECT entity_id FROM continuity_item_entities WHERE item_id = ?')
    for (const item of items) {
      continuity.push({
        session: item.session_id ? ctx.sessions.get(item.session_id) : undefined,
        kind: item.kind,
        text: ctx.transformLinks(item.text) ?? item.text,
        status: item.status,
        nextSession: !!item.next_session,
        createdAt: item.created_at,
        resolvedAt: item.resolved_at ?? undefined,
        entities: (linked.all(item.id) as Array<{ entity_id: number }>)
          .map(l => ctx.entities.get(l.entity_id))
          .filter((id): id is string => !!id),
      })
    }

    const edits = db.prepare('SELECT ref_uid, name, summary, body_md, data_json FROM ref_overrides WHERE campaign_id = ? ORDER BY ref_uid')
      .all(campaignId) as Array<{ ref_uid: string, name: string | null, summary: string | null, body_md: string | null, data_json: string | null }>
    for (const edit of edits) {
      campaignEdits.push({
        refUid: edit.ref_uid,
        name: edit.name ?? undefined,
        summary: edit.summary ?? undefined,
        bodyMd: edit.body_md ?? undefined,
        dataJson: edit.data_json ?? undefined,
      })
    }
  }

  return {
    partyStatus: partyStatus.length ? partyStatus : undefined,
    continuity: continuity.length ? continuity : undefined,
    campaignEdits: campaignEdits.length ? campaignEdits : undefined,
  }
}

interface ImportContext {
  /** export id -> new entity id */
  entities: Map<string, number>
  /** export id -> new session id */
  sessions: Map<string, number>
}

/**
 * Puts the extras of an export into a campaign. Merging into an existing
 * campaign never overwrites its own rules edits.
 */
export function importCampaignExtras(
  db: Database.Database,
  campaignId: number,
  manifest: Pick<CampaignExportManifest, 'partyStatus' | 'continuity' | 'campaignEdits'>,
  ctx: ImportContext,
) {
  const counts = { party: 0, continuity: 0, campaignEdits: 0, skipped: 0 }

  const upsertParty = db.prepare(`
    INSERT INTO party_status (entity_id, ddb_character_id, ddb_stats_json, ddb_explain_json, ddb_fetched_at, manual_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_id) DO UPDATE SET
      ddb_character_id = excluded.ddb_character_id, ddb_stats_json = excluded.ddb_stats_json,
      ddb_explain_json = excluded.ddb_explain_json, ddb_fetched_at = excluded.ddb_fetched_at,
      manual_json = excluded.manual_json, updated_at = CURRENT_TIMESTAMP
  `)
  for (const row of manifest.partyStatus ?? []) {
    const entityId = ctx.entities.get(row.entity)
    if (!entityId) {
      counts.skipped++
      continue
    }
    upsertParty.run(entityId, row.ddbCharacterId ?? null, row.ddbStatsJson ?? null, row.ddbExplainJson ?? null, row.ddbFetchedAt ?? null, row.manualJson || '{}')
    counts.party++
  }

  const insertItem = db.prepare(`
    INSERT INTO continuity_items (campaign_id, session_id, kind, text, status, next_session, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const linkItem = db.prepare('INSERT OR IGNORE INTO continuity_item_entities (item_id, entity_id) VALUES (?, ?)')
  for (const item of manifest.continuity ?? []) {
    if (!CONTINUITY_KINDS.includes(item.kind as never) || typeof item.text !== 'string' || !item.text.trim()) {
      counts.skipped++
      continue
    }
    // {{npc:entity:3}} -> {{npc:57}}; links to entities that weren't imported become plain text
    const text = item.text.replace(ENTITY_LINK, (match, type: string, exportId: string) => {
      const id = ctx.entities.get(exportId)
      return id ? `{{${type}:${id}}}` : match.replace(/\{\{|\}\}/g, '')
    })
    const itemId = Number(insertItem.run(
      campaignId,
      (item.session && ctx.sessions.get(item.session)) || null,
      item.kind,
      text,
      item.status === 'resolved' ? 'resolved' : 'open',
      item.nextSession ? 1 : 0,
      item.createdAt,
      item.resolvedAt ?? null,
    ).lastInsertRowid)
    for (const exportId of item.entities ?? []) {
      const entityId = ctx.entities.get(exportId)
      if (entityId) linkItem.run(itemId, entityId)
    }
    counts.continuity++
  }

  const insertEdit = db.prepare(`
    INSERT INTO ref_overrides (campaign_id, ref_uid, name, summary, body_md, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, ref_uid) DO NOTHING
  `)
  for (const edit of manifest.campaignEdits ?? []) {
    if (insertEdit.run(campaignId, edit.refUid, edit.name ?? null, edit.summary ?? null, edit.bodyMd ?? null, edit.dataJson ?? null).changes) counts.campaignEdits++
  }
  return counts
}
