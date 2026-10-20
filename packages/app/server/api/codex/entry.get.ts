import { getDb } from '../../utils/db'
import { getCodexEntry } from '../../utils/codex'
import { applyCampaignEdits } from '../../utils/codex-user'

// GET /api/codex/entry?uid=spell:fireball|phb&campaignId=1 (campaignId: with that campaign's edits)
export default defineEventHandler((event) => {
  const { uid, campaignId } = getQuery(event)
  if (typeof uid !== 'string' || !uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }
  const entry = getCodexEntry(getDb(), uid)
  if (!entry) {
    throw createError({ statusCode: 404, message: 'Reference not found' })
  }
  return applyCampaignEdits(getDb(), entry, Number(campaignId) || null)
})
