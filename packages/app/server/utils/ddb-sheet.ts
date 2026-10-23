import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DdbSheet, MappedCharacter } from './ddb'
import { getPresetByKey } from './stat-presets'
import { getStatTemplateById, insertStatTemplate, presetGroups } from './stat-template-helpers'
import { getUploadPath } from './paths'
import type { StatValues } from '../../types/stat-template'

/** The D&D 5e stat template; created from the preset the first time a sheet needs it. */
export function ensureDnd5eTemplateId(db: Database.Database): number {
  const existing = db
    .prepare('SELECT id FROM stat_templates WHERE system_key = \'dnd5e\' AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1')
    .get() as { id: number } | undefined
  if (existing) return existing.id
  return insertStatTemplate(db, {
    name: 'D&D 5th Edition',
    systemKey: 'dnd5e',
    description: null,
    groups: presetGroups(getPresetByKey('dnd5e')!),
  })
}

/** Sheet numbers keyed by the dnd5e preset's field names. */
export function ddbStatValues({ sheet, stats }: MappedCharacter): StatValues {
  const values: StatValues = {}
  for (const [field, score] of Object.entries(sheet.scores)) {
    values[field] = { value: score, modifier: Math.floor((score - 10) / 2) }
  }
  values.hp = { current: stats.hpCurrent, max: stats.hpMax }
  values.ac = stats.ac
  values.speed = sheet.speed
  values.initiative = sheet.initiative
  Object.assign(values, sheet.saves, sheet.skills)
  return values
}

/**
 * Merges values into an entity's Stat Block. Without a stat block the D&D 5e one is
 * assigned; with another template only the fields it shares with 5e are filled.
 * Values not given stay as they are.
 */
export function mergeStatBlock(db: Database.Database, entityId: number, newValues: StatValues): void {
  const row = db.prepare('SELECT template_id, values_json FROM entity_stats WHERE entity_id = ?').get(entityId) as
    { template_id: number, values_json: string | null } | undefined
  const template = row ? getStatTemplateById(row.template_id, db) : null

  let templateId: number
  let values: StatValues
  if (row && template) {
    const fieldNames = new Set(template.groups.flatMap(g => g.fields.map(f => f.name)))
    let current: StatValues = {}
    try {
      current = JSON.parse(row.values_json || '{}') as StatValues
    }
    catch {
      // Broken values are replaced
    }
    templateId = row.template_id
    values = { ...current, ...Object.fromEntries(Object.entries(newValues).filter(([key]) => fieldNames.has(key))) }
  }
  else {
    templateId = ensureDnd5eTemplateId(db)
    values = newValues
  }
  db.prepare(
    `INSERT INTO entity_stats (entity_id, template_id, values_json) VALUES (?, ?, ?)
     ON CONFLICT(entity_id) DO UPDATE SET template_id = excluded.template_id, values_json = excluded.values_json,
       updated_at = datetime('now')`,
  ).run(entityId, templateId, JSON.stringify(values))
}

/** The D&D Beyond sheet into the player's Stat Block. */
export function writeDdbStatBlock(db: Database.Database, entityId: number, mapped: MappedCharacter): void {
  mergeStatBlock(db, entityId, ddbStatValues(mapped))
}

/** What the DM typed in the new-player form: ability scores, HP, AC, speed. */
export interface ManualSheet {
  scores?: Partial<Record<string, number>>
  hpMax?: number
  ac?: number
  speed?: number
}

export function writeManualStatBlock(db: Database.Database, entityId: number, sheet: ManualSheet): void {
  const values: StatValues = {}
  const whole = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null)
  for (const field of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const score = whole(sheet.scores?.[field])
    if (score !== null) values[field] = { value: score, modifier: Math.floor((score - 10) / 2) }
  }
  const dex = whole(sheet.scores?.dex)
  if (dex !== null) values.initiative = Math.floor((dex - 10) / 2)
  const hpMax = whole(sheet.hpMax)
  if (hpMax !== null) values.hp = { current: hpMax, max: hpMax }
  const ac = whole(sheet.ac)
  if (ac !== null) values.ac = ac
  const speed = whole(sheet.speed)
  if (speed !== null) values.speed = speed
  if (Object.keys(values).length) mergeStatBlock(db, entityId, values)
}

/** "Variant Human Monk (Way of the Dragon) 7, Sage" for an empty description. */
export function ddbSummary(sheet: DdbSheet, classLabel: string): string {
  const who = [sheet.race, classLabel].filter(Boolean).join(' ')
  return [who, sheet.background].filter(Boolean).join(', ')
}

export function fillEmptyDescription(db: Database.Database, entityId: number, mapped: MappedCharacter): void {
  const summary = ddbSummary(mapped.sheet, mapped.stats.classLabel)
  if (!summary) return
  try {
    db.prepare('UPDATE entities SET description = ? WHERE id = ? AND (description IS NULL OR TRIM(description) = \'\')')
      .run(summary, entityId)
  }
  catch {
    // A nice extra: never let it block the sheet numbers
  }
}

const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/** Uses the D&D Beyond portrait as the player's picture when the player has none yet. */
export async function saveDdbAvatar(db: Database.Database, entityId: number, avatarUrl: string | null): Promise<void> {
  if (!avatarUrl || !/^https:\/\/([a-z0-9-]+\.)*dndbeyond\.com\//i.test(avatarUrl)) return
  const entity = db.prepare('SELECT image_url FROM entities WHERE id = ?').get(entityId) as { image_url: string | null } | undefined
  const imageCount = db.prepare('SELECT COUNT(*) AS n FROM entity_images WHERE entity_id = ?').get(entityId) as { n: number }
  if (!entity || entity.image_url || imageCount.n > 0) return

  try {
    const response = await fetch(avatarUrl, { signal: AbortSignal.timeout(10000) })
    const ext = AVATAR_TYPES[(response.headers.get('content-type') || '').split(';')[0]!.trim()]
    if (!response.ok || !ext) return
    const data = Buffer.from(await response.arrayBuffer())
    if (!data.length || data.length > AVATAR_MAX_BYTES) return
    const uploadsDir = getUploadPath()
    await mkdir(uploadsDir, { recursive: true })
    const fileName = `${randomUUID()}${ext}`
    await writeFile(join(uploadsDir, fileName), data)
    // Checked again: the DM may have added a picture while the download ran
    const still = db.prepare('SELECT image_url FROM entities WHERE id = ?').get(entityId) as { image_url: string | null }
    if (still.image_url) return
    db.prepare('INSERT INTO entity_images (entity_id, image_url, is_primary, display_order) VALUES (?, ?, 1, 0)').run(entityId, fileName)
    db.prepare('UPDATE entities SET image_url = ? WHERE id = ?').run(fileName, entityId)
  }
  catch {
    // The portrait is a nice extra; the sheet numbers already loaded
  }
}
