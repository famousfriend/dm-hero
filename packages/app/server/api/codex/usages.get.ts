import { getDb } from '../../utils/db'
import { getCodexUsages } from '../../utils/codex'

// GET /api/codex/usages?uid=spell:fireball|phb&campaignId=1
export default defineEventHandler((event) => {
  const { uid, campaignId } = getQuery(event)
  if (typeof uid !== 'string' || !uid || !campaignId) {
    throw createError({ statusCode: 400, message: 'uid and campaignId are required' })
  }
  return getCodexUsages(getDb(), Number(campaignId), uid)
})
