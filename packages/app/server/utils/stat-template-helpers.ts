import type Database from 'better-sqlite3'
import type { StatPreset, StatTemplate, StatTemplateDbRow, StatTemplateGroupDbRow, StatTemplateFieldDbRow } from '~~/types/stat-template'

// Shared helper to load a single template with nested groups + fields.
// Used by multiple API routes to avoid internal $fetch() calls.
export function getStatTemplateById(id: number, db: Database.Database = getDb()): StatTemplate | null {
  const template = db
    .prepare<unknown[], StatTemplateDbRow>(
      `SELECT id, name, system_key, description, sort_order, is_imported, created_at, updated_at
       FROM stat_templates WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id)

  if (!template) return null

  const groups = db
    .prepare<unknown[], StatTemplateGroupDbRow>(
      `SELECT id, template_id, name, group_type, sort_order, created_at
       FROM stat_template_groups WHERE template_id = ? ORDER BY sort_order ASC`,
    )
    .all(id)

  const groupIds = groups.map(g => g.id)
  let fields: StatTemplateFieldDbRow[] = []

  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',')
    fields = db
      .prepare<unknown[], StatTemplateFieldDbRow>(
        `SELECT id, group_id, name, label, field_type, has_modifier, sort_order, created_at
         FROM stat_template_fields WHERE group_id IN (${placeholders}) ORDER BY sort_order ASC`,
      )
      .all(...groupIds)
  }

  const fieldsByGroup = new Map<number, StatTemplateFieldDbRow[]>()
  for (const field of fields) {
    const list = fieldsByGroup.get(field.group_id) || []
    list.push(field)
    fieldsByGroup.set(field.group_id, list)
  }

  return {
    ...template,
    system_key: template.system_key as StatTemplate['system_key'],
    is_imported: Boolean(template.is_imported),
    groups: groups.map(g => ({
      ...g,
      group_type: g.group_type as StatTemplate['groups'][number]['group_type'],
      fields: (fieldsByGroup.get(g.id) || []).map(f => ({
        ...f,
        field_type: f.field_type as StatTemplate['groups'][number]['fields'][number]['field_type'],
        has_modifier: Boolean(f.has_modifier),
      })),
    })),
  }
}

export interface NewStatTemplateGroup {
  name: string
  group_type: string
  fields: Array<{ name: string, label: string, field_type: string, has_modifier?: boolean }>
}

/** A preset's groups as stored: i18n keys as labels, so they follow the language. */
export function presetGroups(preset: StatPreset): NewStatTemplateGroup[] {
  return preset.groups.map(g => ({
    name: g.name,
    group_type: g.group_type,
    fields: g.fields.map(f => ({
      name: f.name,
      label: f.label,
      field_type: f.field_type,
      has_modifier: f.has_modifier || false,
    })),
  }))
}

/** Inserts a template with its groups and fields at the end of the list; returns its id. */
export function insertStatTemplate(
  db: Database.Database,
  template: { name: string, systemKey: string | null, description: string | null, groups: NewStatTemplateGroup[] },
): number {
  const maxOrder = db
    .prepare('SELECT MAX(sort_order) as max_order FROM stat_templates WHERE deleted_at IS NULL')
    .get() as { max_order: number | null }
  const insertGroup = db.prepare(
    `INSERT INTO stat_template_groups (template_id, name, group_type, sort_order)
     VALUES (?, ?, ?, ?)`,
  )
  const insertField = db.prepare(
    `INSERT INTO stat_template_fields (group_id, name, label, field_type, has_modifier, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  return db.transaction(() => {
    const result = db
      .prepare('INSERT INTO stat_templates (name, system_key, description, sort_order) VALUES (?, ?, ?, ?)')
      .run(template.name, template.systemKey, template.description, (maxOrder.max_order ?? -1) + 1)
    const templateId = Number(result.lastInsertRowid)
    template.groups.forEach((group, gi) => {
      const groupId = Number(insertGroup.run(templateId, group.name, group.group_type, gi).lastInsertRowid)
      group.fields.forEach((field, fi) => {
        insertField.run(groupId, field.name, field.label, field.field_type, field.has_modifier ? 1 : 0, fi)
      })
    })
    return templateId
  })()
}
