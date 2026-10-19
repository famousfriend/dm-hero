import { getDb } from '../../utils/db'
import { searchCodex } from '../../utils/codex'

// GET /api/codex/search?q=fire&kind=spell&limit=20
export default defineEventHandler((event) => {
  const { q, kind, limit } = getQuery(event)
  return searchCodex(getDb(), typeof q === 'string' ? q : '', {
    kind: typeof kind === 'string' && kind ? kind : undefined,
    limit: limit ? Number(limit) || undefined : undefined,
  })
})
