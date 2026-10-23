import { getPresetByKey } from '../../utils/stat-presets'
import type { CreateStatTemplatePayload } from '~~/types/stat-template'

// Create a new stat template.
// fromPreset: server reads preset, stores i18n keys (labels follow language).
// groups: client sends pre-built structure (plain text labels).
export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody<CreateStatTemplatePayload>(event)

  if (!body.name) {
    throw createError({ statusCode: 400, message: 'Name is required' })
  }

  const systemKey = body.fromPreset || body.system_key || null
  const preset = body.fromPreset ? getPresetByKey(body.fromPreset) : null
  const templateId = insertStatTemplate(db, {
    name: body.name,
    systemKey,
    description: body.description || null,
    groups: preset ? presetGroups(preset) : (body.groups ?? []),
  })

  return getStatTemplateById(templateId)
})
